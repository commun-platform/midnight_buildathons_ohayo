import {
  bytesToHex,
  partnerKeyId,
  partnerScoreMessage,
  type PartnerKey,
  type PartnerScore,
} from '@midnight-demo/shared';

export interface PartnerSigner {
  keyId: string;
  publicKeyHex: string;
  sign(score: PartnerScore): Promise<string>;
}

function base64ToBytes(value: string): Uint8Array {
  return Uint8Array.from(atob(value.trim()), (c) => c.charCodeAt(0));
}

function bytesToBase64(value: Uint8Array): string {
  return btoa(String.fromCharCode(...value));
}

function base64UrlToHex(value: string): string {
  return bytesToHex(base64ToBytes(value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=')));
}

export async function generatePartnerKeys(): Promise<{ signingKey: string; publicKeyHex: string }> {
  const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as {
    privateKey: PartnerKey;
    publicKey: PartnerKey;
  };
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  return { signingKey: bytesToBase64(pkcs8), publicKeyHex: bytesToHex(raw) };
}

export async function partnerSigner(signingKeyBase64: string): Promise<PartnerSigner> {
  const pkcs8 = new Uint8Array(base64ToBytes(signingKeyBase64));
  const exportable = await crypto.subtle.importKey('pkcs8', pkcs8, { name: 'Ed25519' }, true, ['sign']);
  const jwk = await crypto.subtle.exportKey('jwk', exportable);
  if (!jwk.x) throw new Error('PARTNER_SIGNING_KEY is not an Ed25519 private key');
  const publicKeyHex = base64UrlToHex(jwk.x);
  const key = await crypto.subtle.importKey('pkcs8', pkcs8, { name: 'Ed25519' }, false, ['sign']);
  return {
    keyId: await partnerKeyId(publicKeyHex),
    publicKeyHex,
    async sign(score) {
      const signature = await crypto.subtle.sign(
        { name: 'Ed25519' },
        key,
        new Uint8Array(partnerScoreMessage(score)),
      );
      return bytesToHex(new Uint8Array(signature));
    },
  };
}
