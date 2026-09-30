# SADAKO — Next-phase design

> Agreed design (2026-09-30), **being implemented phase by phase — progress in §11**. When phase 6 lands it
> replaces the "everything runs locally" constraint in
> [`worksite_condition_system.md`](worksite_condition_system.md) and `AGENTS.md`.
> The Cloudflare side, wallet login and judging material are ported from
> **BACCHIRI** — <https://github.com/commun-platform/midnight_buildathons_bacchili>
> at commit `562ad131767db99bcf0d2485d7d7edc3f0bd07bb` (§0.2).
>
> [日本語版](ja/next_phase_design.md)

---

## 0. Decisions

| # | Feature | Decision |
|---|---|---|
| 1 | Partner-side dummy server | New `apps/partner-mock/`, its own storage, fetch-style handler (Node locally, a separate Worker when hosted) |
| 2 | Worker screen → dummy server | The browser POSTs **directly** to the partner; SADAKO is not on that path |
| 3 | Admin "fetch data" button | `POST /api/partner/pull` → verified, idempotent insert into `condition_readings` as `pending` |
| 4 | Contract deployment + runbook | Midnight **preprod**, deployed from the development host; runbook `docs/deploy_preprod.md` |
| 5 | Wallet login | Lace via DApp Connector 4.x `signData`; token login is removed |
| 6 | Hosting on workers.dev | Worker + **D1** + **Cloudflare Containers** (chain runner + proof server) + R2 + Cron |
| 7 | Admin's reason for letting a worker work | `work_decisions` table, **DB only** (append-only), no contract change |
| 8 | Evaluator entry | The hosted demo adds a **guest entry** (sandbox personas, no wallet); wallet login stays the real path |
| 9 | Public verifier | `/verify`, no login — reads the entry from the chain, never from the DB |
| 10 | Selective disclosure | A worker issues a disclosure receipt for their own value; `/verify` checks it against the on-chain commitment |
| 11 | In-app demo guide | A five-step checklist that ticks itself |
| 12 | Judging-period operation | Both containers always-on while judging (§9.10) |

The contract (`condition-registry`) does not change in this phase.

Decisions that were weighed and settled, so a later session does not reopen them:

- **Chain writes run in Cloudflare Containers**, not on a local agent — the demo must
  work with the development host switched off.
- **D1**, not Turso — everything stays inside one Cloudflare account, as BACCHIRI does.
- **Decisions stay in the DB** — accepted that they are not tamper-evident.
- **Wallet login replaces token login**; the guest entry (feature 8) exists only so
  that evaluators without Lace can still walk the demo.

### 0.1 Working from this document

This document is the hand-off between sessions. Each phase in §11 is sized for one
session.

1. Read, in order: this document → [`worksite_condition_system.md`](worksite_condition_system.md)
   (the current spec) → `AGENTS.md` → `.claude/skills/sadako-demo/SKILL.md`.
2. Pick the first phase in §11 whose status is not `done`, and read only the §0.2 rows
   it needs.
3. When the phase lands, set its status in §11 and correct anything in this document
   that turned out differently.

Current conventions this design overrides, and when:

| Convention (where) | Changes in |
|---|---|
| "Everything runs locally, no cloud target" (`AGENTS.md`, the spec, `SKILL.md`) | phase 6 |
| "libSQL only. No D1, no Cloudflare" (`SKILL.md`) | phase 0 (D1 adapter — done; `SKILL.md` updated), phase 6 (hosting) |
| "Auth is the token" (`AGENTS.md`, spec §3, `SKILL.md`) | phase 5 — done |
| "Schema changes go straight into `0001_condition_schema.sql`" (`SKILL.md`) | holds until phase 6; after that, numbered migrations (§4.3) |
| The two-press verify (`SKILL.md`, spec §7.4) | phase 7 (§9.8); the tamper checkbox stays |

### 0.2 Reference implementation — BACCHIRI

- Repository: <https://github.com/commun-platform/midnight_buildathons_bacchili>
  (public, Apache-2.0, "BACCHIRI!━━Verifiable Measurement Layer", same organisation).
- Pinned commit: `562ad131767db99bcf0d2485d7d7edc3f0bd07bb` (2026-09-24). Every path
  below exists at this commit.
- Get it outside this repository — do not vendor it:

  ```bash
  git clone https://github.com/commun-platform/midnight_buildathons_bacchili.git ../midnight_buildathons_bacchili
  git -C ../midnight_buildathons_bacchili checkout 562ad131767db99bcf0d2485d7d7edc3f0bd07bb
  ```

  One file only:

  ```bash
  gh api "repos/commun-platform/midnight_buildathons_bacchili/contents/<path>?ref=562ad131767db99bcf0d2485d7d7edc3f0bd07bb" --jq .content | base64 -d
  ```

  Browse: `https://github.com/commun-platform/midnight_buildathons_bacchili/blob/562ad131767db99bcf0d2485d7d7edc3f0bd07bb/<path>`.
- Ported code keeps its Apache-2.0 terms; add a line to SADAKO's `NOTICE` naming
  BACCHIRI as the source.
- BACCHIRI's code carries comments; SADAKO's does not (`AGENTS.md`). Drop them when porting.

| SADAKO part | BACCHIRI path (at the pinned commit) | Take | Change for SADAKO |
|---|---|---|---|
| Worker config (§8.1) | `backend/cloudflare/deployment/wrangler.jsonc` | `containers`, `durable_objects.bindings`, `exports`, `d1_databases` (+ `migrations_dir`), `r2_buckets`, `triggers.crons`, `ratelimits`, `assets` (`binding`, `not_found_handling`, `run_worker_first`), `compatibility_flags` | drop `queues`, the managed-source and MCP bindings; names `sadako` / `sadako-partner`; containers `ChainRunnerContainer` + `ProofServerContainer` |
| Secrets template | `backend/cloudflare/deployment/.dev.vars.example` | layout | SADAKO's secret names (§8.1) |
| Proof server container (§8.1) | `backend/cloudflare/proof-gateway-worker/src/index.ts` — `class ProofServerContainer` (line 86) | `startAndWaitForPorts` with a long `portReadyTimeoutMS`, `allowedHosts: ['srs.midnight.network']`, `interceptHttps`, `SSL_CERT_FILE`, `entrypoint` | none beyond naming |
| Chain runner container (§8.1, §8.2) | same file — `class ServerWalletContainer` (line 180) and `walletRuntimeOutboundByHost` (line 500: `proof.internal` → proof server, `state.internal` → R2 checkpoint) | `enableInternet` + `allowedHosts` (preprod indexer / rpc), `pingEndpoint`, graceful stop, the two internal egress hosts | endpoints `/health`, `/submit`, `/read`, `/open` instead of the sponsor ones |
| Secret injection | `backend/cloudflare/proof-gateway-worker/src/wallet-runtime-secrets.ts` | the seed goes only into the container's process environment | `OPERATING_WALLET_SEED`, `INGESTER_SALT_HEX`, `DEVELOPMENT_PRIVATE_STATE_PASSWORD` |
| Wallet checkpoint (§8.4) | container side: `backend/cloudflare/sponsor-wallet-container/src/checkpoint.ts` (`encryptCheckpoint` / `decryptCheckpoint`, keyed by the seed), `checkpoint-restore.ts`, `checkpoint-upload.ts`, `checkpoint-cache.ts`; Worker side: `backend/cloudflare/proof-gateway-worker/src/sponsor-checkpoint.ts` (R2 keys, 128 MiB cap, recovery copy) | the whole mechanism | R2 keys `sadako-wallet/preprod/checkpoint.enc`; hook it into `persistWalletState` in `packages/midnight-chain/src/wallet.ts` |
| Health and sync progress (§8.2 `/health`) | `backend/cloudflare/sponsor-wallet-container/src/supervisor.ts`, `supervisor-health.ts` (`WalletPhase`, cached health), `sync-progress.ts` | a PID-1 supervisor that answers health from cache while the wallet SDK child syncs | phases map to `starting` / `syncing` / `ready` / `degraded` |
| Container private state (§8.4) | `backend/cloudflare/sponsor-wallet-container/src/in-memory-private-state-provider.ts` | as is | the nonce leaves through the `/submit` response into `opening_ciphertext` |
| Container image | `backend/cloudflare/sponsor-wallet-container/Dockerfile` | `node:22.15.0-bookworm-slim`, workspace-scoped `npm ci`, prover-key presence checks | copy `packages/{midnight-chain,shared,ingester-core,db,condition-read}` and `contracts/condition-registry` with its compiled `src/managed/` |
| One Cron run drives the container | `backend/cloudflare/proof-gateway-worker/src/server-wallet-work.ts` (`acquireServerWalletWarmupLease`, `nextServerWalletWork`) | the lease pattern | the work item is a `queued` row in `condition_readings` |
| Operating profile (§9.10) | `backend/cloudflare/proof-gateway-worker/src/sponsor-operating-window.ts`, `backend/cloudflare/d1-schema/migrations/0037_sponsor_wallet_on_demand.sql`, `docs/operations/sponsor_wallet_operating_hours.md` | a D1 row read by the Cron, restart cool-down | only `always-on` / `on-demand` |
| D1 adapter (§8.4) | `backend/cloudflare/proof-gateway-worker/src/storage/d1.ts` (`D1SqlDatabase`), `storage/sql.ts` | the class body | implement SADAKO's `SqlDatabase` from `packages/db/src/sql.ts` |
| Wallet login, server (§6) | `backend/cloudflare/proof-gateway-worker/src/browser-wallet-signature.ts` | `data === canonical`, then `schnorr.verify(signature, sha256(utf8(canonical)), verifyingKey)` with `@noble/curves/secp256k1` and `@noble/hashes/sha256` | SADAKO's canonical message (§6) |
| Wallet login, browser (§6) | `frontend/verification-portal/src/midnight-device.ts` — `connectBrowserWallet` (line 173): discovery over `window.midnight`, `apiVersion` `4.x`, `connect(networkId)`, `getConnectionStatus`, `getConfiguration` network check, `signData(message, { encoding: 'text', keyType: 'unshielded' })`; `wallet-compatibility.ts` (disconnect / error classification) | the logic | rewrite as a plain ES module in `apps/dashboard/public/` (no build); no shielded addresses needed |
| Partner CORS (§2) | `backend/cloudflare/proof-gateway-worker/src/cors.ts` | the preflight helper | allow `PARTNER_ALLOWED_ORIGIN` only |
| Security headers | `frontend/verification-portal/public/_headers` | CSP shape | SADAKO already has `apps/dashboard/public/_headers` |
| Partner mock API (§2) | `docs/implementation/mock_measurement_source_api.md` | Bearer test token, deterministic responses, `GET /health` | cursor-based `daily-scores`, Ed25519 signatures |
| Deployment runbook (§7) | `docs/operations/demo_runbook.md` | order: wallet → funding → deploy → secrets through `wrangler secret put` on stdin | SADAKO's `condition:*` scripts |
| Submission documents (§9.11) | `docs/submission/README.md`, `evidence_matrix.md`, `judge_qa.md`, `one_page_brief.md`, `deliverables_plan.md` (rubric) | structure and tone | SADAKO's claims |
| Background only | `docs/architecture/system_architecture.md`, `docs/implementation/fee_sponsorship.md`, `frontend/verification-portal/public/demo-mode.js` | — | SADAKO has no fee sponsorship and no `?demo=1` mode |

---

## 1. Target architecture

```
Browser (framework-free SPA, Lace login or guest entry)
   │  /api/*                                   │  POST /v1/measurements (worker screen)
   ▼                                           ▼
Worker sadako                                Worker sadako-partner
 ├─ Static Assets  apps/dashboard/public      ├─ D1 sadako-partner
 ├─ handleApi      (the same code as Node)    └─ Ed25519 signing key (secret)
 ├─ D1 sadako      roster / readings /             ▲
 │                 submissions / decisions /       │ GET /v1/daily-scores (API key)
 │                 wallet bindings / guests        │
 ├─ Cron (1 min)   drain queued readings ──────────┘ (pull is admin-triggered)
 ├─ ChainRunnerContainer   Node + @midnight-demo/midnight-chain
 │     seed / salt from secrets, wallet checkpoint in R2
 │     └─▶ preprod indexer / rpc
 └─ ProofServerContainer   midnightntwrk/proof-server:8.1.0
                                   │
                                   ▼
                     Midnight preprod: condition-registry
```

The local lanes stay: `run.sh e2e` still runs the Node gateway against the local
devnet, now with a local partner mock beside it.

**Core rule: the Worker bundle never loads Midnight WASM.** Proving, wallet sync
and commitment computation live in the containers. The Worker does auth, D1,
the read path (SHA-256 only), partner pulls and the queue.

---

## 2. Partner mock — `apps/partner-mock/`

Stands in for the partner company's ring → app → server path. It owns the
0–100 computation; SADAKO never computes the score.

| Method / path | Auth | What |
|---|---|---|
| `POST /v1/measurements` | none (demo simplification) | Accepts `{ ringId, measuredAt, vitals }` or `{ ringId, measuredAt, score }`, computes the score with a documented deterministic formula, stores it, returns `{ id, ringId, measuredAt, score }` |
| `GET /v1/daily-scores?since=<cursor>` | `Bearer PARTNER_API_KEY` | `{ schemaVersion: 1, keyId, nextCursor, scores: [{ id, ringId, measuredAt, score, signature }] }`, oldest first, bounded page size |
| `POST /v1/simulate` | `Bearer PARTNER_API_KEY` | Generates scores for the given ring ids and day (demo seeding) |
| `GET /health` | none | `{ ok: true }` |

- **Signature**: Ed25519 (WebCrypto — Node 22 and Workers) over
  `sadako-partner-score-v1\n{id}\n{ringId}\n{measuredAt}\n{score}`. SADAKO holds
  `PARTNER_PUBLIC_KEY`. This closes the spec's "partner signature" open question
  off-chain (the circuit still does not check it).
- **Cursor** is the partner's monotonic receive sequence, not `measuredAt`, so a
  late-arriving measurement is never skipped.
- **CORS** allows only `PARTNER_ALLOWED_ORIGIN` (the SADAKO origin).
- **Storage** is separate from SADAKO: `data/partner-mock.db` locally, D1
  `sadako-partner` when hosted, through the existing `SqlDatabase` interface.

---

## 3. Worker screen → partner

- The worker's Today (self) view gets a "ring sync" card: a score input (0–100)
  and a send button. (Decided on 2026-09-30: the score is entered directly; the
  partner API still accepts vitals.)
- The browser POSTs straight to `partnerUrl`. The raw value reaches SADAKO only
  when the admin pulls, which mirrors the real data path.
- Changes: `/api/me` adds `ringId` (the current `ring_worker_map` entry);
  `/api/config` adds `partnerUrl`; CSP `connect-src` adds the partner origin
  (the Worker sets it from `PARTNER_URL`; the static `_headers` cannot know it).
- After sending, the card says the value is recorded once the admin fetches it.

As built in phase 2: the browser-facing partner URL is `PUBLIC_PARTNER_URL`
(falling back to `PARTNER_URL`), because the gateway reaches the partner over the
Docker network (`http://mn-condition-partner:8788`) while the browser needs
`http://localhost:8788`. `securityHeaders(partnerUrl)` in
`apps/gateway/src/security.ts` builds the headers — identical to `_headers` when no
partner is configured, with the partner origin added to `connect-src` otherwise — and
the Node server applies them to every static response; the Worker will use the same
function. `ringId` is the worker's open `ring_worker_map` row (`null` when unassigned,
which hides the card). The partner's CORS allows only `PARTNER_ALLOWED_ORIGIN`, so the
dashboard must be opened as `http://localhost:8787`, not `127.0.0.1`.

---

## 4. Admin pull and the submission queue

### 4.1 Pull

`POST /api/partner/pull` (admin) calls `pullPartnerScores` in
`apps/ingester/src/partner.ts` (fetch-based, SDK-free; also exposed as
`npm run ingest:pull`):

1. Page through `daily-scores` from the stored cursor.
2. Per score: verify the signature → check `0 ≤ score ≤ 100` → check the ring is
   in the roster.
3. Insert into `condition_readings` with `source='partner_api'`,
   `status='pending'`, `external_id`, `partner_sig`. An existing `external_id`
   with identical content is a duplicate; with different content it is a
   **conflict** and is never overwritten.
4. Advance the cursor only after the page is stored.

Returns `{ fetched, inserted, duplicates, conflicts, badSignature, invalid, unknownRing, cursor }`.

As built in phase 1 (API and details: [`partner_mock_api.md`](partner_mock_api.md)):
`invalid` counts validly signed scores outside 0..100; a `keyId` that is not the
pinned key, or an HTTP error, aborts the pull without moving the cursor; rejected
scores are consumed (the cursor moves past them); each page's rows and cursor are
written in one batch. `partner_sync` holds the cursor.

### 4.2 Queue UI

The Data admin screen gets the pending-readings table (the existing
`GET /api/staged`, which has no UI today) and a "submit to chain" button
(`POST /api/staged/submit`).

| status | Meaning |
|---|---|
| `pending` | pulled, not yet requested |
| `queued` | the admin pressed submit; waiting for the chain runner |
| `submitted` | on chain, `submissions` row written |
| `skipped` | not plannable (`skip_reason`) |
| `failed` | the runner gave up (`last_error`); can be re-queued |

Node (local devnet) submits in-process as today. Hosted, the button marks rows
`queued`, returns **202**, and the Cron drains them (§8.3).

As built in phase 1: the button submits every `pending`, `queued` and `failed` row,
and `recordOutcomes` (`apps/ingester/src/submit.ts`) writes each row's outcome from
the index-aligned `ReadingOutcome[]` — a failure marks that row `failed` with
`last_error` instead of aborting the batch. `skip_reason` gains `unknown_ring` and
`invalid_value`. Partner rows are shown to the admin as a band only
(`GET /api/staged` returns `value: null`). Decided on 2026-09-30:
the admin's one-shot submit form (and `POST /api/submit`) is gone — scores are
entered only by workers — and its tamper checkbox moved next to "submit to chain"
(`POST /api/staged/submit { tamper }`), where it stays (§9.8). The manual-row
endpoints `POST /api/staged` and `PATCH /api/staged/:id` are gone too, so no admin
endpoint enters or edits a value.

### 4.3 Schema changes

Until the hosted D1 exists (phase 6), edit
`packages/db/migrations/0001_condition_schema.sql` directly — the current rule in
`.claude/skills/sadako-demo/SKILL.md`. Once D1 holds data, later changes become new
numbered migration files.

- `condition_readings`: `external_id TEXT UNIQUE`, `partner_sig TEXT`,
  `last_error TEXT`, `status` gains `queued` / `failed`.
- `partner_sync (source TEXT PRIMARY KEY, cursor TEXT, synced_at TEXT)`.
- `submissions`: `opening_ciphertext TEXT` (§8.4).
- The tables of §5, §6 and §9.4.

---

## 5. Work decisions (admin's reason)

```
work_decisions (
  id             TEXT PRIMARY KEY,
  worker_id      TEXT NOT NULL,
  period_start_ms INTEGER NOT NULL,
  entry_key      TEXT,
  band           TEXT,
  decision       TEXT NOT NULL CHECK (decision IN ('worked', 'light_duty', 'rested')),
  reason         TEXT NOT NULL,
  decided_by     TEXT NOT NULL,
  decided_at     TEXT NOT NULL,
  supersedes_id  TEXT
)
```

- **Append-only.** There is only `POST`; a correction is a new row with
  `supersedes_id`. The current decision is the newest row not superseded. Every
  write also goes to `audit_log`.
- **Required** when the day's band is `caution` / `danger` and the decision is
  `worked` / `light_duty`; optional otherwise. `band` and `entry_key` snapshot
  what the admin saw.
- API: `GET /api/decisions?workerId=&from=&to=` (admin; a worker reads only their
  own), `POST /api/decisions` (admin).
- UI: admin Today cards show "decision missing" on caution/danger days → dialog
  (decision + reason). The list view and CSV gain a decision column. The worker's
  own view shows the decision and reason read-only.
- **Not guaranteed:** the operator can still edit the DB directly — decisions are
  not tamper-evident. Anchoring a commitment on chain stays future work (add this
  line to §11 of the spec).

---

## 6. Wallet login (replaces token login)

The same mechanism BACCHIRI runs on preprod (`browser-wallet-signature.ts` and
`midnight-device.ts`, §0.2).

```
SPA                                    Worker
 │ window.midnight[*] with apiVersion 4.x
 │ connect(walletNetworkId)
 │── POST /api/auth/challenge {inviteCode?} ──▶ store {id, message, exp 5 min}
 │◀─ { challengeId, message } ──────────────────
 │ signData(message, { encoding: 'text', keyType: 'unshielded' })
 │── POST /api/auth/verify {challengeId, data, signature, verifyingKey} ──▶
 │                          single-use, unexpired, data === message,
 │                          schnorr.verify(signature, sha256(message), verifyingKey)
 │                          keyHash = sha256(verifyingKey) → role
 │◀─ { session, role, workerId } ────────────────
```

- **Message**: `SADAKO-LOGIN-V1\n{origin}\n{challengeId}\n{nonce}\n{issuedAt}` plus
  `invite:{code}` when an invite is being redeemed.
- **Verification** uses `@noble/curves` (secp256k1 BIP-340 over the SHA-256 of the
  payload) — no WASM, runs in the Worker. Signing needs no funds.
- **Roles**: `keyHash ∈ ADMIN_WALLET_KEY_HASHES` (secret) → admin; a
  `wallet_bindings` row → that worker; otherwise 403 `unregistered`, showing the
  key hash so an admin can be bootstrapped.
- **Binding a worker**: the admin issues a one-time invite code for a worker
  (shown once, stored hashed, expires). The worker connects, the code is inside the
  signed message, and the binding is created.
- **Session**: `v1.<payload>.<HMAC-SHA256>` with `{ sub: keyHash, role, workerId, exp }`
  under `SESSION_SECRET`, 12 h, sent as `Bearer` as today. `authenticate()` in
  `apps/gateway/src/auth.ts` checks the MAC, the expiry, and that the binding is not
  revoked.
- **Removed**: `ADMIN_TOKEN` and worker-id tokens. README, the demo skill and the
  spec's §3 are updated. Evaluators without a wallet use the guest entry (§9.4),
  which issues sandbox sessions only and is off unless `GUEST_ENTRY=1`.
- **Local**: `run.sh e2e` needs Lace unless `GUEST_ENTRY=1`. Login is
  network-independent, so Lace connected to preprod can log into a dashboard that
  submits to the local devnet. Tests sign with keys generated by `@noble/curves`.

```
wallet_bindings (id TEXT PRIMARY KEY, key_hash TEXT NOT NULL, worker_id TEXT NOT NULL,
                 created_at TEXT NOT NULL, revoked_at TEXT)
                 -- unique key_hash and unique worker_id among rows with revoked_at IS NULL
worker_invites  (code_hash TEXT PRIMARY KEY, worker_id TEXT NOT NULL,
                 expires_at TEXT NOT NULL, used_at TEXT, created_by TEXT NOT NULL)
auth_challenges (id TEXT PRIMARY KEY, message TEXT NOT NULL, invite_hash TEXT,
                 expires_at TEXT NOT NULL, used_at TEXT)
```

As built in phase 5 (`apps/gateway/src/{login,auth,session,wallet-signature}.ts`):

- The message carries `invite:<sha256 of the code>` rather than the code, so no
  plaintext code is stored with the challenge (`auth_challenges.invite_hash`).
- `wallet_bindings` has its own id with partial unique indexes, so a revoked binding
  can be replaced by a new one for the same wallet or worker.
- The key hash is SHA-256 of the verifying-key string (as BACCHIRI's `walletKeySha256`).
  SHA-256 comes from WebCrypto; only `@noble/curves` 1.9.7 is added, which the
  workspace already had at the root.
- The signed bytes are `midnight_signed_message:<byte length>:` + the message: the DApp
  Connector spec makes this prefix a MUST and Lace applies it since lace-extension 2.4.0
  (2026-09-23, `sign-message-prefix.ts`). BACCHIRI's pinned verifier predates it and
  verifies the bare message, which no longer matches a current Lace signature.
- A challenge is consumed before the signature is checked, so a failed attempt cannot
  be retried with the same challenge.
- Sessions are stateless; `authenticate()` re-checks the admin key list and the
  worker's binding on every request, so unlinking a wallet ends its sessions.
- `run.sh e2e` generates a local `SESSION_SECRET` into `.state/gateway/session-secret`
  and turns guest entry on (`GUEST_ENTRY=0` to require Lace). The first Lace login with
  an unregistered wallet shows the key hash to put in `ADMIN_WALLET_KEY_HASHES`.
- Rate limiting of `/api/auth/*` is left to the Workers `ratelimits` binding (phase 6).

---

## 7. Preprod deployment and runbook

Deployment runs from the development host, not from Cloudflare — the same split as
BACCHIRI's `docs/operations/demo_runbook.md`. `docs/deploy_preprod.md`
(+ `docs/ja/`) covers:

1. `.env.preprod` (not `.env`, which holds the devnet wallet that `run.sh e2e` writes):
   the private-state password and `INGESTER_SALT_HEX`. The lane points the CLI at it
   with `DEVELOPMENT_ENV_FILE` and starts its own proof server container.
2. `run.sh deploy_preprod wallet` → address; the mnemonic is written to `.env.preprod`.
3. Fund tNIGHT from the preprod faucet.
4. `run.sh deploy_preprod funding` → wait for tNIGHT.
5. `run.sh deploy_preprod deploy` → DUST wallet sync, NIGHT registration, DUST,
   proof, deploy → `CONDITION_REGISTRY_CONTRACT_ADDRESS`. With a new wallet this took
   about 70 minutes on 2026-09-30, about 65 of them the DUST wallet sync.
6. `run.sh deploy_preprod status` → confirm.
7. Hand over to Cloudflare: seed → `OPERATING_WALLET_SEED`, salt → `INGESTER_SALT_HEX`,
   address → Worker vars, each through `wrangler secret put` on stdin so nothing is
   echoed. **From here only the container uses this wallet**; the submitter key is
   derived from the seed (`submitterSecretKeyHex` in
   `packages/midnight-chain/src/state.ts`), and concurrent use from two hosts collides
   on DUST.
8. Seed the showcase history (§9.7).
9. Replacing a contract: a new address is a new registry; old rows keep their
   `deployment_id`, the salt is unchanged.

Done in phase 4: the `run.sh deploy_preprod` lane (+ `run.ps1`) runs this without Node on the host, and the contract is on preprod at `1fca6b4cec100a425db72d769d1ef19f673de7552b4c9196611797f6b565e7ed` (details in [`deploy_preprod.md`](deploy_preprod.md)).

---

## 8. Cloudflare hosting

### 8.1 Resources

| Resource | Role |
|---|---|
| Worker `sadako` | `worker.ts`: `handleApi(request, deps) ?? env.ASSETS.fetch(request)`; Cron; container classes |
| D1 `sadako` | `packages/db/migrations` applied with `wrangler d1 migrations apply` |
| `ChainRunnerContainer` | Node image over `@midnight-demo/midnight-chain`; egress only to the preprod indexer / rpc and the Worker-routed internal hosts; `sleepAfter` 10 m outside judging |
| `ProofServerContainer` | the official `proof-server:8.1.0` image; fetches its proving parameters from `srs.midnight.network` on every fresh start; `sleepAfter` 2 m outside judging |
| R2 `sadako-wallet-state` | encrypted wallet sync checkpoint (warm restore) |
| Worker `sadako-partner` + D1 `sadako-partner` | the partner mock |
| Secrets | `OPERATING_WALLET_SEED`, `INGESTER_SALT_HEX`, `DEVELOPMENT_PRIVATE_STATE_PASSWORD`, `SESSION_SECRET`, `OPENING_KEY`, `ADMIN_WALLET_KEY_HASHES`, `PARTNER_API_KEY`, `PARTNER_PUBLIC_KEY` (and the partner's signing key) |

Cloudflare Containers need the Workers Paid plan, and container time is billed
while running (§9.10).

### 8.2 Container API (reachable only through the Durable Object binding)

| Endpoint | What |
|---|---|
| `GET /health` | `starting` / `syncing` (+ progress) / `ready` / `degraded`, DUST available |
| `POST /submit` | `{ readings: [{ readingId, ringId, recordedAt, value }] }` → the `ReadingOutcome[]` of `submitReadings` (§8.4), index-aligned with `readings`: `submitted` (the `PlannedSubmission` — `entryKey`, `periodStartMs`, `recordedAtMs`, `band`, `scoreCommitmentHex`, `nonceHex` — plus `txId`, `txHash`, `blockHeight`, and `recovered`), `skipped` (`SkipReason`), or `failed` (`error`) |
| `POST /read` | `{ entryKeys }` → on-chain entries. Needs only the indexer and the compiled contract, **not** a synced wallet, so verify works while the wallet is still syncing |
| `POST /open` | `{ scoreCenti, nonceHex }` → `scoreCommitmentHex`, for the disclosure receipt check (§9.6) |

### 8.3 Queue

Every minute the Cron picks `queued` readings. If `/health` is not `ready` they
stay queued and the UI shows "wallet syncing"; otherwise they go to `/submit` in
bounded batches and the Worker writes the `submissions` rows. The contract's
`assert(!entries.member(key))` keeps retries safe. BACCHIRI adds Cloudflare Queues +
DLQ (`queues` in its `wrangler.jsonc`); SADAKO can add them later if volume demands.

### 8.4 Refactors this requires

Phase 0 landed the first three items; they describe the code as built.

- **WASM split** (done): `conditionScoreCommitment` (`persistentCommit`) lives in
  `packages/shared/src/commitment.ts` and is exported only as
  `@midnight-demo/shared/commitment`. The root export — bands, periods,
  `conditionEntryKey` (WebCrypto), hex — is Worker-safe. The importers are
  `ingester-core`'s `plan.ts` (so planning runs where the chain runs: in-process on
  Node, in the container when hosted) and the contract tests.
  `apps/gateway/src/boundary.test.ts` walks the value-import graph (type-only imports
  are skipped) from the Worker-facing modules — `routes.ts`, `deps.ts`,
  `apps/ingester/src/{store,submit,reconcile}.ts`, `condition-read`,
  `packages/db/src/{d1,migrate}.ts` — and fails on `@midnight-ntwrk/*`,
  `midnight-chain`, the contract package, `shared/commitment`, `@libsql/*`,
  `@polkadot/*`, `dotenv` or `node:*`. A second case proves the walk does flag
  `plan.ts`.
- **Chain vs DB** (done): `packages/midnight-chain` no longer depends on
  `@midnight-demo/db`. Rather than keeping `submitReading` / `submitStagedFeed` /
  `reconcileSubmissions` there with the writes stripped out, it exposes one port,
  `conditionChain(network, address)`, implementing `ConditionChain` from
  `packages/ingester-core/src/types.ts`:
  - `submitReadings({ readings, roster, submittedEntryKeys, salt })` plans each
    reading, opens the wallet only if something is plannable, proves and submits, and
    returns one `ReadingOutcome` per reading, index-aligned: `submitted`
    (`PlannedSubmission` including `nonceHex`, the tx, and `recovered: true` when the
    contract said the entry was already on chain and it was read back), `skipped`
    (`SkipReason`), or `failed` (`error`). A failure no longer aborts the rest of the
    batch; the DB side records the successes and then raises the first failure.
  - `readEntries(entryKeys)` → `Map<entryKey, OnChainEntry>` (`readConditionEntries`
    in `reader.ts`), one indexer query per call.

  The DB side is SDK-free in `apps/ingester/src/`: `store.ts` (row access),
  `submit.ts` (`submitStagedFeed` with the tamper option, `recordOutcomes`), `reconcile.ts` (`reconcileSubmissions`,
  still `phased` until §9.8). It drives any `ConditionChain` and is tested offline
  against a fake chain (`submit.test.ts`). `apps/gateway/src/server.ts` wires the
  in-process chain behind the unchanged `GatewayDeps.submit / reconcile /
  submitStaged` seams; the Worker will wire a container-backed `ConditionChain`
  (`/submit` → `submitReadings`, `/read` → `readEntries`) behind the same seams and
  call `recordOutcomes` from the Cron. The CLI reconciles through the same port.
- **D1 adapter** (done): `SqlDatabase.kind` is `'libsql' | 'd1'`.
  `d1Database(env.DB)` (`@midnight-demo/db/d1`, also `./sql` and `./migrate` as
  libSQL-free subpaths) ports BACCHIRI's `D1SqlDatabase`
  (`backend/cloudflare/proof-gateway-worker/src/storage/d1.ts`) against a structural
  `D1DatabaseLike` type, so no `@cloudflare/workers-types` dependency yet. Tested
  against a libSQL-backed fake binding (`d1.test.ts`).
- **Private state**: the container's private state is in memory (BACCHIRI's
  `in-memory-private-state-provider.ts`), so the commitment opening (`nonce`)
  returned by `/submit` is stored in `submissions.opening_ciphertext` (AES-GCM under
  `OPENING_KEY`).
- **Wallet checkpoint**: port BACCHIRI's `checkpoint.ts`, `checkpoint-restore.ts`,
  `checkpoint-upload.ts`, `checkpoint-cache.ts` and the Worker-side
  `sponsor-checkpoint.ts`, including the stalled-sync recovery; save after sync and
  after each submission.

### 8.5 How this differs from BACCHIRI

| | BACCHIRI | SADAKO |
|---|---|---|
| Who builds the tx | the device binds it; the server wallet only adds DUST (fee sponsorship, `docs/implementation/fee_sponsorship.md`) | the operating wallet is the submitter, so the container plans, proves and submits |
| Job delivery | Queues + DLQ + Cron | Cron over the D1 `status` column |
| Frontend | Vite build with midnight-js (`frontend/verification-portal/vite.config.ts`) | no build — the SPA only calls `connect` / `signData` |
| Containers | proof server + server wallet (`standard-2` + `standard-4`) | proof server + chain runner, sized by measurement (§9.10) |

---

## 9. Evaluator experience

### 9.0 How evaluators score

BACCHIRI's `docs/submission/deliverables_plan.md` maps the Midnight Buildathon rubric
as follows — confirm it against the official rules before relying on it.

| Category | Weight | What the demo must show |
|---|---:|---|
| Engineering & Implementation | 40% | a real ZK proof and transaction; the privacy boundary actually held |
| Quality Assurance & Reliability | 15% | tamper rejection, reproducible tests, a demo that stays up |
| Product & Vision | 15% | the problem and who gains what |
| User Experience & Design | 15% | an obvious path; visible state |
| Communication | 10% | claims matched to evidence |
| Business Development & Viability | 5% | an adoption path |

### 9.1 Principles

1. **No empty screens.** A showcase history is on preprod before judging starts (§9.7).
2. **One action, one conviction.** Each step proves one claim, and the claim is written next to it.
3. **Show waits, and fill them.** A transaction shows `queued → proving → submitted → confirmed`
   with elapsed time and an explorer link; while it waits, the screen shows what the ledger
   will and will not contain.
4. **Claim beside evidence.** Every step links its source, test and transaction;
   `docs/submission/evidence_matrix.md` is the same table in long form.
5. **Evaluators do not collide.** Each guest gets a fresh worker and ring, so the contract's
   one-entry-per-(ring, day) rule never rejects a second evaluator.
6. **Evaluable when something is down.** The video, dated transaction evidence in the README
   and local reproduction do not depend on the hosted demo.
7. **Honest limits.** `docs/submission/judge_qa.md` states what is not proven.

### 9.2 Evaluation paths

| Path | Time | Needs | Shows |
|---|---|---|---|
| README + video | 3 min | nothing | the story and the three core claims |
| Hosted demo | 5 min | a browser | the golden path (§9.3) |
| Repository review | 15 min | Docker | `run.sh test_all`, evidence matrix, judge Q&A |
| Local reproduction | 20 min | Docker | `run.sh e2e` with `GUEST_ENTRY=1` |

The three core claims: only the worker sees their raw value; the chain holds only the band;
altering the operator's database is caught by the chain.

### 9.3 Golden path

| # | Role | Action | Conviction |
|---|---|---|---|
| 1 | Worker | ring sync → sees their own score | the raw value is seen only by the worker and the partner |
| 2 | Admin | pull from the partner → bands only, no numbers → record a decision for the danger worker | not even the admin sees the value; the decision is on record |
| 3 | Admin | submit → progress → explorer link | a real Midnight transaction and ZK proof |
| 4 | Third party (no login) | paste the entryKey / tx into `/verify` → band, commitment, block only; then paste the worker's disclosure receipt → "matches" | the chain alone identifies nobody and reveals no value, yet the worker can prove theirs |
| 5 | Admin | tamper the local record → verify → mismatch, restored from the chain | tamper-evidence a signed database cannot give |

Steps 2, 4 and 5 work on the showcase history, so they never wait for step 3.

### 9.4 Guest entry

- `POST /api/auth/guest` exists only when `GUEST_ENTRY=1` (on for the hosted demo,
  optional locally). It creates a guest (`guest-<8 hex>`), provisions a fresh worker and
  ring assigned to it, and returns a 2 h session `{ sub: 'guest:<id>', role, workerId, guest: true }`.
- `POST /api/auth/guest/persona { role }` reissues the session as the admin or as the
  guest's worker. The header shows the persona and a "sandbox — production login is the
  wallet" banner.
- The guest admin sees the whole demo site but may only change its own worker and ring,
  record decisions, and tamper / verify rows (a tampered row heals on verify). Seeded rows
  cannot be deleted.
- Quotas: at most 3 on-chain submissions per guest plus a global hourly cap (D1 counters);
  Workers rate limiting on `/api/auth/*` (the `ratelimits` block in BACCHIRI's
  `wrangler.jsonc`).
- A nightly reset returns D1 to the showcase snapshot. Guest entries already on chain stay
  there; they are pseudonymous and harmless.

```
guest_sessions (id TEXT PRIMARY KEY, worker_id TEXT NOT NULL, ring_id TEXT NOT NULL,
                created_at TEXT NOT NULL, expires_at TEXT NOT NULL)
```

As built in phase 5: a guest starts in the worker persona. The guest admin cannot
change the roster at all (the guest's worker and ring are created at entry), can
delete and submit only readings of the guest's own ring, and records decisions and
verifies anywhere. Submission limits are counted from `submissions.submitted_by`
(`guest:<id>`) rather than a counter column: `GUEST_SUBMISSION_LIMIT` (default 3) per
guest and `GUEST_HOURLY_LIMIT` (default 30) across guests per hour; the submit call
passes the remaining allowance as its `limit`, and a spent allowance returns 429.

### 9.5 Public verifier — `/verify`

- No login. `GET /api/public/entry?entryKey=` or `?tx=` (a tx hash resolves to its entryKey
  through `submissions`); the entry itself is always read **from the chain** — the container's
  `/read` when hosted, `ConditionChain.readEntries` (`readConditionEntries` in
  `packages/midnight-chain/src/reader.ts`) on Node — never from D1.
- Shows the band, the day, `recordedAt`, `scoreCommitment`, the block and an explorer link,
  plus an explicit "not on the ledger" list: name, ring id, raw value.
- Rate limited.

### 9.6 Disclosure receipt (selective disclosure)

- On their own history a worker can issue a receipt: `POST /api/disclosures { entryKey }`
  (the worker, own entries only — the admin cannot). The Worker decrypts
  `opening_ciphertext` and returns
  `{ v: 1, entryKey, scoreCenti, nonceHex, scoreCommitmentHex, periodDate, issuedAt }` to
  copy or download. Each issuance goes to `audit_log`.
- `/verify` accepts a pasted receipt and checks `persistentCommit(scoreCenti, nonce)`
  against the on-chain `scoreCommitment`: "78.00 matches the normal-band entry recorded on
  2026-09-12".
- `persistentCommit` needs `compact-runtime`, so the hosted check runs in the container
  (`POST /open`). Verification that trusts no server runs locally:
  `condition-cli verify-receipt receipt.json`. A pure-JS reimplementation in the browser is a
  spike, adopted only if tests prove byte-equality with `compact-runtime`.
- Disclosure is the worker's choice: the receipt reveals that one value and links that entry
  to whoever holds it. The salt is never disclosed.

### 9.7 Showcase data

- `npm run condition:seed-showcase` (a runbook step after deployment): four synthetic
  workers × 14 days as real preprod transactions — normal / caution / danger mixed, danger
  days with recorded decisions (one "worked" with a reason, one "rested"), and one day with
  no reading. The contract's window check is relative to `periodStartMs`, so past days can
  be backfilled.
- The resulting D1 state is the nightly-reset snapshot.

### 9.8 Verify and tamper UX

- **Verify is one press.** It always reads the chain (the two-phase `phased: true`
  behaviour of `reconcileSubmissions` in `apps/ingester/src/reconcile.ts` goes away) and shows local vs. chain side by side.
  Hosted, `/read` needs no synced wallet, so it answers quickly.
- **Tamper stays the checkbox next to "submit to chain"** (decided 2026-09-30,
  replacing the earlier per-row button plan). The worker's value stays in the local
  record while the chain receives a cross-band value
  (`submitStagedFeed(…, { tamper: true })` in `apps/ingester/src/submit.ts`); the next
  verify reports the mismatch and restores the row from the chain. Hosted, the flag
  travels with the queued rows to the Cron. A tampered demo therefore costs one
  transaction, like any submission.
- A status banner shows the chain runner (`ready` / `syncing n%`) and the proof server.

### 9.9 In-app demo guide

- A collapsible panel lists the five steps of §9.3, each with what to do, what it proves,
  and links to source / test / tx.
- Steps tick themselves from `GET /api/guide` (per guest session: measurement sent, pull +
  decision, submission confirmed, public verify / receipt checked, tamper detected).
- Open by default for guests, hidden behind a toggle for wallet users; ja / en.

### 9.10 Judging-period operation and cost

The operating profile is a D1 setting read by the Cron, as in BACCHIRI's
`sponsor-operating-window.ts`: `always-on` while judging, `on-demand` otherwise. The proof
server downloads its proving parameters from `srs.midnight.network` on every fresh start
(BACCHIRI allows a 10-minute port-ready timeout for it), so on-demand means a multi-minute
first proof; while judging both containers stay up.

Estimate from the published Cloudflare Containers prices (checked 2026-09-30,
<https://developers.cloudflare.com/containers/pricing/>): memory $0.0000025 / GiB-s and
disk $0.00000007 / GB-s are billed on the provisioned size, CPU $0.000020 / vCPU-s on
active use only; Workers Paid ($5 / month) includes 25 GiB-h, 375 vCPU-min and 200 GB-h.
Instance sizes from <https://developers.cloudflare.com/containers/platform-details/limits/>:
`standard-1` 1/2 vCPU · 4 GiB · 8 GB, `standard-2` 1 vCPU · 6 GiB · 12 GB,
`standard-4` 4 vCPU · 12 GiB · 20 GB. 30-day months, idle CPU assumed 0.05–0.25 vCPU,
USD→JPY at 150.

| Configuration | Per month | 3 months |
|---|---|---|
| BACCHIRI's sizing (proof `standard-2` + runner `standard-4`), both 24 h | $130–140 | $390–420 (≈ ¥59–63k) |
| Both 24 h, proof `standard-2` + runner `standard-2` | $90–100 | $270–300 (≈ ¥40–45k) |
| **Both 24 h, proof `standard-1` + runner `standard-2` (recommended while judging)** | **$75–85** | **$225–255 (≈ ¥34–38k)** |
| Runner 24 h (`standard-2`), proof on demand | $50–60 | $150–180 (≈ ¥23–27k) |
| Runner 09–21 JST only, proof on demand | $27–33 | $80–100 (≈ ¥12–15k) |

- Memory is ~90 % of the bill, so right-sizing is the lever: measure the runner's peak
  (wallet sync / restore) and the proof server's in phase 6 before picking sizes. BACCHIRI
  runs its wallet on `standard-4`, but that wallet serves more roles than SADAKO's; if
  SADAKO's also needs it, add about $39 / month.
- D1, R2, Workers requests and the minute Cron fit the Workers Paid allowances at demo
  volume; Durable Object duration adds a few dollars at most. Preprod fees are DUST from
  faucet tNIGHT — no money.
- Keep enough DUST for the guest quota × days, with an alert when it runs low.
- Baking the proving parameters into a derived proof-server image would make on-demand
  viable (seconds, not minutes) — a spike worth doing if the judging window is long.

### 9.11 Submission documents

`docs/submission/` (+ `docs/ja/submission/`), with the structure of BACCHIRI's
`docs/submission/`: `README.md` (review guide and reading order), `evidence_matrix.md`
(claim → source → test → dated tx), `judge_qa.md` (including what is not proven: the
partner value's truth, decisions not being tamper-evident, worker attribution being an
operator claim), and `one_page_brief.md`. The top README leads with the one-line value,
the video, the hosted URL with "try as a guest", the three core claims and the §9.2
paths. A ~3-minute video follows §9.3.

---

## 10. Privacy changes

| Data | Where, after this phase |
|---|---|
| Raw 0–100 value | partner D1, SADAKO D1 (`condition_readings`); passes Worker → container on submit; never in R2 or logs |
| Band / commitment / entryKey | unchanged (chain + D1) |
| Commitment opening (`nonce`) | D1, AES-GCM encrypted; leaves only in a receipt the worker issues |
| Disclosure receipt | issued only by the worker; its holder learns that one value and entry |
| Wallet verifying key | only its SHA-256, in D1 — never on chain |
| Guest session | D1, no personal data, 2 h |
| Decision reason | D1 only; admin and the worker themselves |
| Partner signature | D1 |
| Salt | Worker + container secrets |

Holding raw values in a cloud database is acceptable for this demo because the
data is synthetic; the spec's privacy table states it explicitly.

---

## 11. Phases

Each phase is one session. Update **Status** when a phase lands.

| # | Phase | Main files | Done when | Status |
|---|---|---|---|---|
| 0 | Refactors: WASM split, chain/DB split, D1 adapter (§8.4) | `packages/shared`, `packages/midnight-chain`, `packages/db`, `apps/gateway/src/deps.ts` | all `run.sh` test lanes green; a boundary test proves no `compact-runtime` in the Worker graph | done (2026-09-30) |
| 1 | Partner mock, pull, queue UI (features 1, 3) | `apps/partner-mock/`, `apps/ingester/src/partner.ts`, `apps/gateway/src/admin.ts`, `apps/dashboard/public/app.js`, `0001_condition_schema.sql` | pull is idempotent; signature / conflict / unknown-ring cases tested | done (2026-09-30) — also walked on the local devnet: pull → queue → 3 txs submitted and verified |
| 2 | Worker screen send (feature 2) | `apps/dashboard/public/app.js`, `apps/gateway/src/routes.ts` | a value sent from the worker screen reaches the chain after pull + submit (local devnet) | done (2026-09-30) — ring sync → pull → submit → verified tx on the local devnet |
| 3 | Work decisions (feature 7) | `apps/gateway`, `apps/dashboard/public/app.js`, `0001_condition_schema.sql` | required-reason rule and append-only behaviour tested | done (2026-09-30) — also recorded, rejected without a reason, and corrected in the browser on the local devnet |
| 4 | Preprod deploy + runbook (feature 4) | `docs/deploy_preprod.md`, `docs/ja/deploy_preprod.md`, `run.sh`, `run.ps1` | contract on preprod following only the runbook | done (2026-09-30) — deployed with the lane the runbook documents; the runbook records that run |
| 5 | Wallet login + guest entry (features 5, 8) | `apps/gateway/src/auth.ts`, `apps/dashboard/public/`, tests | token login removed; challenge replay, expiry, wrong key, invite reuse rejected; guest limits tested | done (2026-09-30) — guest flow walked in the browser on the local devnet; an admin login with a real Lace wallet succeeded after adopting the connector-spec `midnight_signed_message:` prefix |
| 6 | Worker + D1 + containers (feature 6) | `apps/gateway/src/worker.ts`, `wrangler.jsonc`, container image, checkpoint port (§0.2) | the full flow works on workers.dev with the development host off; memory measured for §9.10 | not started |
| 7 | Evaluation layer: public verifier, disclosure receipt, guide, verify / tamper UX, showcase seed, judging profile (features 9–12) | `apps/gateway`, `apps/dashboard/public/`, `apps/development/condition-cli` | a guest completes the golden path on workers.dev in 5 minutes | not started |
| 8 | Submission documents + video (§9.11) | `docs/submission/`, `docs/ja/submission/`, `README.md` | every claim in the evidence matrix resolves to source, test or tx | not started |

---

## 12. Risks

- **Wallet sync inside a container** is the largest cost. BACCHIRI's history up to the
  pinned commit is mostly stalled-sync recovery (for example
  `fix(sponsor): recover stalled wallet synchronization`). Port it rather than rewrite it.
- **Cold start**: after `sleepAfter`, the first submission waits for container
  boot, parameter download, checkpoint restore and sync catch-up. The UI must show it.
- **Guest entry is open to abuse**: per-guest and global quotas, rate limits, the nightly
  reset, and a DUST alert.
- **Always-on cost** depends on sizes not yet measured (§9.10).
- **Receipt check in the browser** needs a byte-exact `persistentCommit`; until proven, the
  container and the CLI do it.
- **Decisions are not tamper-evident** (accepted with "DB only").
- **One wallet, one host** after the handover in §7.
