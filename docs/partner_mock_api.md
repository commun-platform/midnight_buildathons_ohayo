# Partner mock API

> [日本語版](ja/partner_mock_api.md)

`apps/partner-mock/` stands in for the partner company's ring → app → server path. It
owns the 0–100 score: it turns vitals into a score, stores it in **its own** database,
signs every score it hands out, and never talks to OHAYO!'s database. OHAYO! pulls from
it (the Data admin screen's **Pull from partner** button, `POST /api/partner/pull`).

The handler is fetch-shaped (`handlePartner(request, deps)` in
`apps/partner-mock/src/handler.ts`), so the same code runs as a Node server locally and
as its own Worker when hosted ([`next_phase_design.md`](next_phase_design.md) §2, §8).

## Endpoints

| Method / path | Auth | Purpose |
|---|---|---|
| `POST /v1/measurements` | none (demo simplification) | take `{ ringId, measuredAt, vitals }` or `{ ringId, measuredAt, score }`, store it, return `201 { id, ringId, measuredAt, score }` |
| `GET /v1/daily-scores?since=<cursor>[&limit=n]` | `Bearer PARTNER_API_KEY` | signed scores after the cursor, oldest first |
| `POST /v1/simulate` | `Bearer PARTNER_API_KEY` | `{ ringIds, date: 'YYYY-MM-DD' }` → one deterministic score per ring for that day (demo seeding) |
| `GET /health` | none | `{ ok: true }` |

- `ringId` is 1–64 characters of `A–Z a–z 0–9 _ -`.
- `measuredAt` is any ISO 8601 instant; it is stored and signed in canonical UTC form
  (`new Date(ms).toISOString()`), so `2026-09-30T07:30:00+09:00` becomes
  `2026-09-29T22:30:00.000Z`.
- Bodies are capped at 4 KiB.

### Score formula

With vitals `{ heartRate, hrvMs, sleepHours, spo2, skinTempDelta }` (all numbers) and
`clamp01(x) = min(1, max(0, x))`:

```
score = 30 · clamp01(sleepHours / 8)
      + 25 · clamp01((hrvMs − 20) / 60)
      + 20 · clamp01((90 − heartRate) / 35)
      + 15 · clamp01((spo2 − 90) / 8)
      + 10 · clamp01(1 − |skinTempDelta| / 1.5)
```

rounded to two decimals. Eight hours of sleep, HRV ≥ 80 ms, heart rate ≤ 55 bpm,
SpO₂ ≥ 98 % and no temperature deviation give 100. A direct `score` is rounded to two
decimals too. The formula is illustrative; OHAYO! does not depend on it.

`POST /v1/simulate` does not use vitals: the score is
`20 + (first two bytes of SHA-256("ringId|date") mod 8001) / 100`, the id is
`sim-<ringId>-<date>`, and `measuredAt` is 07:30 JST that day. Repeating the call
returns the same scores with `created: false`.

### `GET /v1/daily-scores`

```json
{
  "schemaVersion": 1,
  "keyId": "3f2a9c0d1e4b5a67",
  "nextCursor": "42",
  "scores": [
    { "id": "m-…", "ringId": "ring-1", "measuredAt": "2026-09-29T22:30:00.000Z", "score": 78.5, "signature": "…128 hex…" }
  ]
}
```

- **Cursor.** `nextCursor` is the partner's monotonically increasing receive sequence of
  the last score in the page — not `measuredAt` — so a late-arriving measurement for an
  earlier time is still delivered. Pass it back as `since`. An empty page returns the
  same cursor. Page size is at most 100.
- **Signature.** Ed25519 over the UTF-8 bytes of

  ```
  ohayo-partner-score-v1\n{id}\n{ringId}\n{measuredAt}\n{score}
  ```

  where `{score}` is JavaScript's `String(score)`. `partnerScoreMessage` and
  `verifyPartnerScore` in `packages/shared/src/partner.ts` are the single definition,
  used by the mock to sign and by OHAYO! to verify (WebCrypto, so it runs in Node 22 and
  in Workers).
- **`keyId`** is the first 16 hex characters of SHA-256 of the raw public key.

## What OHAYO! does with a page

`pullPartnerScores` in `apps/ingester/src/partner.ts`:

1. Reads the stored cursor (`partner_sync`, source `partner_api`) and requests pages until
   one is empty.
2. Rejects the whole pull, without moving the cursor, if `keyId` is not the key OHAYO!
   pinned (`PARTNER_PUBLIC_KEY`) or the partner answers with an HTTP error.
3. Per score: signature → `badSignature`; outside 0..100 or an unparseable instant →
   `invalid`; ring not in `rings` → `unknownRing`; an `external_id` already stored with
   the same ring, time and score → `duplicates`; with different content → `conflicts`
   (never overwritten). Anything else becomes a `condition_readings` row with
   `source='partner_api'`, `status='pending'`, `external_id` and `partner_sig`.
4. Writes the page's rows and the new cursor in one batch.

Rejected scores are consumed: the cursor moves past them. A ring registered later does not
pick up scores it missed; the partner can re-send them under new ids.

## Keys and configuration

```bash
npm run keygen -w @midnight-demo/partner-mock
```

prints `PARTNER_SIGNING_KEY` (PKCS#8, base64), `PARTNER_PUBLIC_KEY` (raw, hex) and a random
`PARTNER_API_KEY`.

| Variable | Partner mock | OHAYO! gateway |
|---|---|---|
| `PARTNER_SIGNING_KEY` | required | — |
| `PARTNER_PUBLIC_KEY` | — | required for pull |
| `PARTNER_API_KEY` | required | required for pull |
| `PARTNER_URL` | — | required for pull |
| `PARTNER_ALLOWED_ORIGIN` | the OHAYO! origin allowed to `POST /v1/measurements` (default `http://localhost:8787`) | — |
| `PARTNER_DB_URL` | libSQL URL (default `file:data/partner-mock.db`) | — |
| `PARTNER_PORT` | default `8788` | — |

`run.sh e2e` generates a development key set into `.state/partner-mock/dev.env` (git-ignored)
on first use, starts `mn-condition-partner` on <http://localhost:8788> with its own
`mn-condition-partner-data` volume, and hands the gateway the public key and API key.
To seed scores for a ring:

```bash
docker exec mn-condition-partner npx tsx apps/partner-mock/src/cli.ts simulate --rings ring-1
```

## CORS

Only `POST /v1/measurements` is meant for browsers (the worker's ring-sync card, which posts to `PUBLIC_PARTNER_URL`).
It answers a preflight with `204` only for `Origin: PARTNER_ALLOWED_ORIGIN`, method `POST`
and at most the `content-type` header, and adds `Access-Control-Allow-Origin` only for that
origin. `daily-scores` and `simulate` send no CORS headers: they are server-to-server.
