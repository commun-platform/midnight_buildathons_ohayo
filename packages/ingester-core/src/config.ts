import { hexToBytes } from '@midnight-demo/shared';

export function loadSalt(env: NodeJS.ProcessEnv = process.env): Uint8Array {
  const hex = env.INGESTER_SALT_HEX?.trim();
  if (!hex) throw new Error('INGESTER_SALT_HEX is required (hex, >= 16 bytes)');
  const bytes = hexToBytes(hex);
  if (bytes.length < 16) throw new Error('INGESTER_SALT_HEX must be at least 16 bytes');
  return bytes;
}
