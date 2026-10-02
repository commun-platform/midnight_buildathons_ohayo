import { resolveRingScope } from '@midnight-demo/condition-read';
import {
  APP_TIME_ZONE,
  openOpening,
  parseDisclosureReceipt,
  periodDate,
  type DisclosureReceipt,
} from '@midnight-demo/shared';

import { authenticate } from './auth.js';
import type { GatewayDeps } from './deps.js';

const ENTRY_KEY = /^\d{1,90}$/;
const TX_REF = /^[0-9a-fA-F]{8,128}$/;
const NOT_ON_LEDGER = ['workerName', 'ringId', 'value'] as const;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = (await request.json()) as unknown;
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function entryKeyFor(deps: GatewayDeps, url: URL): Promise<string | null | 'invalid'> {
  const entryKey = url.searchParams.get('entryKey')?.trim();
  if (entryKey) return ENTRY_KEY.test(entryKey) ? entryKey : 'invalid';
  const tx = url.searchParams.get('tx')?.trim().toLowerCase().replace(/^0x/, '');
  if (!tx) return 'invalid';
  if (!TX_REF.test(tx)) return 'invalid';
  const row = await deps.db.first<{ entry_key: string }>(
    'SELECT entry_key FROM submissions WHERE lower(tx_hash) = ? OR lower(tx_id) = ? LIMIT 1',
    [tx, tx],
  );
  return row?.entry_key ?? null;
}

async function publicEntry(deps: GatewayDeps, entryKey: string) {
  if (!deps.chain) return null;
  const entry = (await deps.chain.readEntries([entryKey])).get(entryKey);
  if (!entry) return null;
  const local = await deps.db.first<{ tx_hash: string | null; tx_id: string | null; block_height: string | null }>(
    'SELECT tx_hash, tx_id, block_height FROM submissions WHERE entry_key = ?',
    [entryKey],
  );
  return {
    entryKey,
    band: entry.band,
    periodDate: periodDate(entry.periodStartMs, APP_TIME_ZONE),
    periodStartMs: entry.periodStartMs,
    recordedAt: new Date(entry.recordedAtMs).toISOString(),
    scoreCommitmentHex: entry.scoreCommitmentHex,
    tx: local?.tx_hash
      ? { txHash: local.tx_hash, blockHeight: local.block_height === 'unknown' ? null : local.block_height }
      : null,
    contractAddress: deps.config?.contractAddress ?? null,
    explorerUrl: deps.config?.explorerUrl ?? null,
    source: 'chain' as const,
    notOnLedger: NOT_ON_LEDGER,
  };
}

async function handleEntry(request: Request, deps: GatewayDeps): Promise<Response> {
  if (request.method !== 'GET') return json(405, { error: 'Method not allowed' });
  if (!deps.chain) return json(501, { error: 'Reading the chain is not configured on this server' });
  const entryKey = await entryKeyFor(deps, new URL(request.url));
  if (entryKey === 'invalid') return json(400, { error: 'Pass ?entryKey=<decimal> or ?tx=<hex>' });
  if (!entryKey) return json(404, { error: 'No entry with that transaction' });
  const entry = await publicEntry(deps, entryKey);
  return entry ? json(200, entry) : json(404, { error: 'The chain has no entry with that key' });
}

async function handleReceiptCheck(request: Request, deps: GatewayDeps): Promise<Response> {
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });
  if (!deps.chain || !deps.openCommitment) {
    return json(501, { error: 'Checking receipts is not configured on this server' });
  }
  const body = await readJson(request);
  const receipt = parseDisclosureReceipt(body?.receipt ?? body);
  if (!receipt) return json(400, { error: 'That is not a disclosure receipt' });
  const entry = await publicEntry(deps, receipt.entryKey);
  if (!entry) return json(404, { error: 'The chain has no entry with that key' });
  const computed = await deps.openCommitment(receipt.scoreCenti, receipt.nonceHex);
  const matches = computed === entry.scoreCommitmentHex && receipt.scoreCommitmentHex === entry.scoreCommitmentHex;
  return json(200, {
    matches,
    entry,
    ...(matches ? { value: receipt.scoreCenti / 100 } : {}),
  });
}

async function handleDisclosure(request: Request, deps: GatewayDeps): Promise<Response> {
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });
  const viewer = await authenticate(deps, request);
  if (!viewer) return json(401, { error: 'Unauthorized' });
  if (viewer.role !== 'worker' || !viewer.workerId) {
    return json(403, { error: 'Only the worker the entry belongs to can disclose it', code: 'worker_only' });
  }
  if (!deps.openingKeyHex) return json(501, { error: 'Disclosure receipts are not configured on this server' });
  const body = await readJson(request);
  const entryKey = typeof body?.entryKey === 'string' ? body.entryKey.trim() : '';
  if (!ENTRY_KEY.test(entryKey)) return json(400, { error: 'entryKey is required' });

  const row = await deps.db.first<{
    ring_id: string;
    period_start_ms: number;
    score_commitment_hex: string;
    opening_ciphertext: string | null;
  }>(
    'SELECT ring_id, period_start_ms, score_commitment_hex, opening_ciphertext FROM submissions WHERE entry_key = ?',
    [entryKey],
  );
  const scope = new Set(await resolveRingScope(deps.db, viewer));
  if (!row || !scope.has(row.ring_id)) return json(404, { error: 'No such entry of yours' });
  if (!row.opening_ciphertext) {
    return json(409, { error: 'This entry has no stored opening (it was recorded before receipts existed)', code: 'no_opening' });
  }

  const opening = await openOpening(deps.openingKeyHex, entryKey, row.opening_ciphertext);
  const issuedAt = new Date().toISOString();
  const receipt: DisclosureReceipt = {
    v: 1,
    entryKey,
    scoreCenti: opening.scoreCenti,
    nonceHex: opening.nonceHex,
    scoreCommitmentHex: row.score_commitment_hex,
    periodDate: periodDate(Number(row.period_start_ms), APP_TIME_ZONE),
    issuedAt,
  };
  await deps.db.execute(
    `INSERT INTO audit_log (id, actor_user_id, action, target_table, target_id, before_json, after_json, ts)
     VALUES (?, ?, 'disclosure.issue', 'submissions', ?, NULL, ?, ?)`,
    [crypto.randomUUID(), viewer.subject, entryKey, JSON.stringify({ issuedAt }), issuedAt],
  );
  return json(200, receipt);
}

async function unavailableOnError(handler: () => Promise<Response>): Promise<Response> {
  try {
    return await handler();
  } catch (error) {
    console.error(JSON.stringify({ message: 'public_read_failed', error: error instanceof Error ? error.message : String(error) }));
    return json(503, { error: 'The chain could not be read just now - try again in a minute', code: 'chain_unavailable' });
  }
}

export async function handlePublic(request: Request, deps: GatewayDeps): Promise<Response | null> {
  const { pathname } = new URL(request.url);
  if (pathname === '/api/public/entry') return unavailableOnError(() => handleEntry(request, deps));
  if (pathname === '/api/public/receipt') return unavailableOnError(() => handleReceiptCheck(request, deps));
  if (pathname === '/api/disclosures') return handleDisclosure(request, deps);
  return null;
}
