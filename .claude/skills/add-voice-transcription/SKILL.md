---
name: add-voice-transcription
description: Add local voice message transcription via parakeet-mlx. Automatically transcribes audio attachments from Signal and Chat SDK channels. macOS Apple Silicon only.
---

# Add Voice Transcription

Adds local speech-to-text transcription for voice messages using [parakeet-mlx](https://github.com/senstella/parakeet-mlx) on Apple Silicon. Supports 25 European languages with automatic detection.

When installed, voice messages from any channel arrive as `[Voice: <transcribed text>]` instead of `[Voice Message]`.

## Prerequisites

- **macOS on Apple Silicon** (MLX is Apple-only)
- **Python 3.14**: `brew install python@3.14`
- **ffmpeg**: `brew install ffmpeg`

## Install

### Pre-flight (idempotent)

Skip to **Setup** if all of these are already in place:

- `src/modules/transcription/index.ts` and `src/modules/transcription/sidecar.ts` exist
- `scripts/transcription_worker.py` exists
- `src/modules/index.ts` contains `import './transcription/index.js';`

Otherwise continue. Every step below is safe to re-run.

### 1. Fetch the skill branch

```bash
git fetch origin skill/voice-transcription
```

### 2. Copy the module files

```bash
git show origin/skill/voice-transcription:scripts/transcription_worker.py > scripts/transcription_worker.py
mkdir -p src/modules/transcription
git show origin/skill/voice-transcription:src/modules/transcription/index.ts > src/modules/transcription/index.ts
git show origin/skill/voice-transcription:src/modules/transcription/sidecar.ts > src/modules/transcription/sidecar.ts
```

### 3. Append the module barrel import

Append to `src/modules/index.ts` (skip if already present):

```typescript
import './transcription/index.js';
```

### 4. Build

```bash
pnpm run build
```

## Setup

### 1. Create Python venv and install dependencies

```bash
python3.14 -m venv venv314
venv314/bin/pip install --quiet parakeet-mlx numpy
```

### 2. Download the model (~2.5 GB)

```bash
venv314/bin/python -c "
from parakeet_mlx import from_pretrained
import os
model_dir = os.path.join(os.getcwd(), 'data', 'models', 'parakeet')
os.makedirs(model_dir, exist_ok=True)
from_pretrained('mlx-community/parakeet-tdt-0.6b-v3', cache_dir=model_dir)
print('Model downloaded successfully')
"
```

### 3. Verify

Restart NanoClaw and check the startup log for:

```
Transcription: available
```

If you see `Transcription: unavailable (venv not found)` or `(ffmpeg not found)`, check that the venv and ffmpeg are installed correctly.

## Adapter Integration

After installing the transcription module, patch whichever channel adapters are installed to call `transcribeVoice()`.

### Signal (`src/channels/signal.ts`)

If Signal is installed, find the voice message placeholder block (search for `'[Voice Message]'`). Replace the entire `if (hasVoice)` block with:

```typescript
if (hasVoice) {
  const audio = dataMessage.attachments?.find((a) => a.contentType?.startsWith('audio/'));
  if (audio?.id) {
    const attachmentPath = join(config.signalDataDir, 'attachments', audio.id);
    if (existsSync(attachmentPath)) {
      let transcript: string | null = null;
      try {
        const { transcribeVoice } = await import('../modules/transcription/index.js');
        const audioBuffer = readFileSync(attachmentPath);
        transcript = await transcribeVoice(audioBuffer);
      } catch {
        // transcription module not available
      }
      content = transcript ? `[Voice: ${transcript}]` : '[Voice Message]';
    } else {
      content = '[Voice Message - file not found]';
    }
  } else {
    content = '[Voice Message]';
  }
}
```

Add `readFileSync` to the existing `fs` imports if not already present:

```typescript
import { existsSync, readFileSync } from 'fs';
```

### Chat SDK channels (`src/channels/chat-sdk-bridge.ts`)

If any Chat SDK channels are installed (Telegram, Discord, Slack, Teams, etc.), find the `messageToInbound` function and add transcription after the attachment enrichment loop. After the `serialized.attachments = enriched;` line, add:

```typescript
// Transcribe audio attachments on text-less messages
const audioAtt = enriched.find(
  (a: Record<string, unknown>) =>
    typeof a.mimeType === 'string' && a.mimeType.startsWith('audio/') && a.data,
);
if (audioAtt && !serialized.text?.trim()) {
  try {
    const { transcribeVoice } = await import('../modules/transcription/index.js');
    const transcript = await transcribeVoice(Buffer.from(audioAtt.data as string, 'base64'));
    if (transcript) {
      serialized.text = `[Voice: ${transcript}]`;
    }
  } catch {
    // transcription module not available
  }
}
```

### Voice echo in router (`src/router.ts`)

In the `deliverToAgent()` function, find the `writeSessionMessage(...)` call. Immediately after the closing `});` of that call, add:

```typescript
  // Echo voice transcript so the user sees what was heard
  const parsed = JSON.parse(event.message.content);
  const voiceText: unknown = typeof parsed === 'string' ? parsed : parsed?.text;
  if (typeof voiceText === 'string') {
    const voiceMatch = voiceText.match(/^\[Voice:\s+(.+)\]$/);
    if (voiceMatch?.[1]) {
      const echoAdapter = getChannelAdapter(deliveryAddr.channelType ?? event.channelType);
      if (echoAdapter) {
        echoAdapter
          .deliver(deliveryAddr.platformId, deliveryAddr.threadId, {
            kind: 'chat',
            content: { text: `You said: "${voiceMatch[1]}"` },
          })
          .catch((err) => log.warn('Failed to echo voice transcript', { err }));
      }
    }
  }
```

`getChannelAdapter` is already imported at the top of `router.ts`.

### Build and restart

```bash
pnpm run build
```

```bash
# macOS
launchctl kickstart -k gui/$(id -u)/com.nanoclaw

# Linux
systemctl --user restart nanoclaw
```

## How It Works

A persistent Python sidecar process loads the parakeet-mlx model once and stays warm. When a voice message arrives, the host writes the audio to a temp file and sends the path to the sidecar via JSON stdin. The sidecar uses ffmpeg to normalize the audio to 16kHz mono float32, runs inference, and returns the transcript via JSON stdout.

- **Model**: `mlx-community/parakeet-tdt-0.6b-v3` (~600M params, ~2.5 GB)
- **Languages**: 25 European languages, auto-detected
- **Latency**: 1-5 seconds depending on audio length
- **Audio formats**: Anything ffmpeg can decode (OGG/Opus, M4A, WAV, etc.)
- **Failure mode**: Returns null on error — adapter falls back to `[Voice Message]`
- **Worker crash**: Auto-respawned on next transcription request
