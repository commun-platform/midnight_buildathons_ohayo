import fs from 'node:fs';
import path from 'node:path';

import { hexToBytes } from '@midnight-demo/shared';

export const CHECKPOINT_FILES = ['shielded', 'unshielded', 'dust'] as const;

export type CheckpointFiles = Partial<Record<(typeof CHECKPOINT_FILES)[number], string>>;

export const MAX_CHECKPOINT_BYTES = 64 * 1024 * 1024;

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const HEADER = encoder.encode('OHAYO-WALLET-CHECKPOINT-V1\n');
const IV_BYTES = 12;

async function checkpointKey(seedHex: string) {
  const seed = hexToBytes(seedHex.trim().replace(/^0x/i, ''));
  const material = new Uint8Array(HEADER.length + seed.length);
  material.set(HEADER, 0);
  material.set(seed, HEADER.length);
  const digest = await crypto.subtle.digest('SHA-256', material);
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function sealCheckpoint(files: CheckpointFiles, seedHex: string): Promise<Uint8Array<ArrayBuffer>> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const plaintext = encoder.encode(JSON.stringify({ v: 1, files }));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: HEADER },
      await checkpointKey(seedHex),
      plaintext,
    ),
  );
  const sealed = new Uint8Array(HEADER.length + IV_BYTES + ciphertext.length);
  sealed.set(HEADER, 0);
  sealed.set(iv, HEADER.length);
  sealed.set(ciphertext, HEADER.length + IV_BYTES);
  return sealed;
}

export async function openCheckpoint(sealed: Uint8Array, seedHex: string): Promise<CheckpointFiles> {
  if (sealed.length <= HEADER.length + IV_BYTES || sealed.length > MAX_CHECKPOINT_BYTES) {
    throw new Error('the wallet checkpoint has an invalid size');
  }
  if (!HEADER.every((byte, index) => sealed[index] === byte)) {
    throw new Error('the wallet checkpoint has an unknown format');
  }
  const iv = sealed.slice(HEADER.length, HEADER.length + IV_BYTES);
  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: HEADER },
      await checkpointKey(seedHex),
      sealed.slice(HEADER.length + IV_BYTES),
    );
  } catch {
    throw new Error('the wallet checkpoint does not open with this wallet seed');
  }
  const parsed = JSON.parse(decoder.decode(plaintext)) as { v?: unknown; files?: Record<string, unknown> };
  if (parsed.v !== 1 || !parsed.files || typeof parsed.files !== 'object') {
    throw new Error('the wallet checkpoint has an unknown version');
  }
  const files: CheckpointFiles = {};
  for (const name of CHECKPOINT_FILES) {
    const value = parsed.files[name];
    if (typeof value === 'string') files[name] = value;
  }
  return files;
}

export function readWalletFiles(dir: string): CheckpointFiles {
  const files: CheckpointFiles = {};
  for (const name of CHECKPOINT_FILES) {
    const file = path.join(dir, `${name}.json`);
    if (fs.existsSync(file)) files[name] = fs.readFileSync(file, 'utf8');
  }
  return files;
}

export function writeWalletFiles(dir: string, files: CheckpointFiles): void {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  for (const name of CHECKPOINT_FILES) {
    const content = files[name];
    if (content === undefined) continue;
    const file = path.join(dir, `${name}.json`);
    const temporary = `${file}.tmp-${process.pid}`;
    fs.writeFileSync(temporary, content, { mode: 0o600 });
    fs.renameSync(temporary, file);
  }
}
