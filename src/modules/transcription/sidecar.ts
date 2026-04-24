import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import readline from 'readline';

import { log } from '../../log.js';

const VENV_PYTHON = path.join(process.cwd(), 'venv314', 'bin', 'python');
const WORKER_SCRIPT = path.join(process.cwd(), 'scripts', 'transcription_worker.py');
const REQUEST_TIMEOUT_MS = 60_000;

interface Worker {
  proc: ChildProcessWithoutNullStreams;
  reader: readline.Interface;
  ready: Promise<void>;
}

let currentWorker: Worker | null = null;
let requestQueue: Promise<unknown> = Promise.resolve();

function startWorker(): Worker {
  log.info('Spawning parakeet transcription worker');
  const proc = spawn(VENV_PYTHON, [WORKER_SCRIPT], {
    cwd: process.cwd(),
    stdio: ['pipe', 'pipe', 'pipe'],
  }) as ChildProcessWithoutNullStreams;

  proc.stderr.on('data', (chunk: Buffer) => {
    process.stderr.write(chunk);
  });
  proc.on('exit', (code, signal) => {
    log.warn('Transcription worker exited', { code, signal });
    if (currentWorker?.proc === proc) currentWorker = null;
  });

  const reader = readline.createInterface({ input: proc.stdout });
  const ready = new Promise<void>((resolve, reject) => {
    const onLine = (line: string) => {
      try {
        const msg = JSON.parse(line);
        if (msg.ready) {
          reader.off('line', onLine);
          resolve();
        }
      } catch {
        /* ignore non-JSON noise */
      }
    };
    reader.on('line', onLine);
    proc.once('exit', () => reject(new Error('worker exited before ready')));
  });

  return { proc, reader, ready };
}

function getWorker(): Worker {
  if (!currentWorker) currentWorker = startWorker();
  return currentWorker;
}

async function transcribeOne(audioPath: string): Promise<string | null> {
  const worker = getWorker();
  await worker.ready;

  return new Promise<string | null>((resolve) => {
    const timeout = setTimeout(() => {
      worker.reader.off('line', onLine);
      log.error('Transcription request timed out');
      resolve(null);
    }, REQUEST_TIMEOUT_MS);

    const onLine = (line: string) => {
      let msg: { text?: string; error?: string; ready?: boolean };
      try {
        msg = JSON.parse(line);
      } catch {
        return;
      }
      if (msg.ready) return;
      worker.reader.off('line', onLine);
      clearTimeout(timeout);
      if (msg.error) {
        log.error('Transcription worker error', { err: msg.error });
        resolve(null);
      } else {
        resolve(msg.text?.trim() || null);
      }
    };
    worker.reader.on('line', onLine);
    worker.proc.stdin.write(JSON.stringify({ audio_path: audioPath }) + '\n');
  });
}

/**
 * Transcribe an audio buffer to text via the parakeet-mlx Python sidecar.
 * Multilingual, auto-detected (25 European languages). Channel-agnostic —
 * any channel can call this with a raw audio buffer (ogg/opus, m4a, wav, etc).
 */
export async function transcribe(audioBuffer: Buffer): Promise<string | null> {
  const task = requestQueue.then(async () => {
    const tmpPath = path.join(os.tmpdir(), `claw-voice-${Date.now()}.ogg`);
    try {
      fs.writeFileSync(tmpPath, audioBuffer);
      return await transcribeOne(tmpPath);
    } catch (err) {
      log.error('Transcription failed', { err });
      return null;
    } finally {
      try {
        fs.unlinkSync(tmpPath);
      } catch {
        /* best-effort cleanup */
      }
    }
  });
  requestQueue = task.catch(() => {});
  return task;
}
