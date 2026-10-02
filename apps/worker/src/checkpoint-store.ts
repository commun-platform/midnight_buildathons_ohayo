export interface CheckpointBucket {
  get(key: string): Promise<{ body: ReadableStream; size: number } | null>;
  put(key: string, value: ArrayBuffer): Promise<unknown>;
}

export const MAX_CHECKPOINT_BYTES = 64 * 1024 * 1024;

export function walletCheckpointKey(network: string): string {
  return `ohayo-wallet/${network}/checkpoint.enc`;
}

export function walletCheckpointPreviousKey(network: string): string {
  return `ohayo-wallet/${network}/checkpoint.previous.enc`;
}

export async function handleCheckpoint(
  request: Request,
  bucket: CheckpointBucket,
  network: string,
): Promise<Response> {
  const { pathname } = new URL(request.url);
  if (pathname !== '/checkpoint') return new Response('Not found', { status: 404 });
  const key = walletCheckpointKey(network);

  if (request.method === 'GET') {
    const object = await bucket.get(key);
    if (!object) return new Response('No checkpoint', { status: 404 });
    return new Response(object.body, {
      headers: { 'content-type': 'application/octet-stream', 'cache-control': 'no-store' },
    });
  }

  if (request.method === 'PUT') {
    const declared = Number(request.headers.get('content-length') ?? '0');
    if (declared > MAX_CHECKPOINT_BYTES) return new Response('Too large', { status: 413 });
    const body = await request.arrayBuffer();
    if (body.byteLength === 0 || body.byteLength > MAX_CHECKPOINT_BYTES) {
      return new Response('Invalid size', { status: 413 });
    }
    const previous = await bucket.get(key);
    if (previous) await bucket.put(walletCheckpointPreviousKey(network), await new Response(previous.body).arrayBuffer());
    await bucket.put(key, body);
    return new Response(null, { status: 204 });
  }

  return new Response('Method not allowed', { status: 405 });
}
