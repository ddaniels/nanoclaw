import { existsSync } from 'fs';
import { execSync } from 'child_process';
import path from 'path';
import { log } from '../../log.js';

const VENV_PYTHON = path.join(process.cwd(), 'venv314', 'bin', 'python');

let available: boolean | null = null;

function checkAvailable(): boolean {
  if (available !== null) return available;
  if (!existsSync(VENV_PYTHON)) {
    log.info('Transcription: unavailable (venv not found)', { path: VENV_PYTHON });
    available = false;
    return false;
  }
  try {
    execSync('which ffmpeg', { stdio: 'ignore' });
  } catch {
    log.info('Transcription: unavailable (ffmpeg not found)');
    available = false;
    return false;
  }
  log.info('Transcription: available');
  available = true;
  return true;
}

// Check at module load time for startup logging
checkAvailable();

/**
 * Transcribe an audio buffer to text via the parakeet-mlx Python sidecar.
 * Returns null if transcription prerequisites are not installed or if
 * transcription fails. The sidecar is lazily started on first call.
 */
export async function transcribeVoice(audioBuffer: Buffer): Promise<string | null> {
  if (!checkAvailable()) return null;
  const { transcribe } = await import('./sidecar.js');
  return transcribe(audioBuffer);
}
