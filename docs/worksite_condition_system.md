# SADAKO — Design document

> Records a partner-computed worksite condition value on Midnight and serves a
> role-scoped three-state view. **This document is the canonical spec for the
> current repository.**
>
> **Hackathon build** — everything runs locally; there is no cloud deployment
> target. Two roles (admin / worker), a single worksite, and the login token is
> the worker's id.
>
> [日本語版](ja/worksite_condition_system.md)

---

## 1. Background and purpose

### The system

Construction-site workers wear a smart ring. The ring → phone app → server path,
and the computation of **one 0–100 condition value per worker per day** (a
physical-condition index — **higher is better**), belong to a **partner
company**. This repository takes it from there:

1. Ingest the partner's daily value.
2. Record it on the Midnight blockchain (tamper-evidence, auditability).
3. Serve each worker's **three-state band** (`正常` normal / `要注意` caution /
   `危険` danger) from the contract, scoped by role.

### Why a blockchain

So that "worker X was in the caution band on day D" is recorded in a form that
**cannot be rewritten afterwards** and that an admin or the worker themselves can
**verify independently**. A signed database would suffice if only in-house
managers ever read it; the chain exists to make third-party verification work.

**At the same time the raw 0–100 value never reaches the chain.** Only the band
does. A physical-condition index is close to sensitive personal data and has no
business sitting in a world-readable ledger. Midnight's zero-knowledge proofs are
what make this possible: they prove the band was derived correctly while keeping
the value private.

### The three states

| Condition value | State | enum |
|---|---|---|
| 60–100 | 正常 normal | `normal` |
| 40–59 | 要注意 caution | `caution` |
| 0–39 | 危険 danger | `danger` |

Thresholds live in `packages/shared/src/condition.ts` (`CONDITION_NORMAL_MIN=60`
/ `CONDITION_CAUTION_MIN=40`). Values may be fractional; inside the contract they
are handled as `round(value × 100)` (0–10000), so the thresholds are 6000 / 4000.

---

## 2. Architecture

```
┌────────────── partner company ──────────────┐
│  smart ring → app → server                   │ … biometrics & the 0–100 value
└───────────────┬─────────────────────────────┘
                │  (today) condition_readings table / (future) HTTP API
                ▼
        ┌──────────────────┐
        │  Node ingester    │  processes each ring whose value has arrived
        │  apps/ingester    │  - reads roster + feed from the DB
        │                   │  - builds entryKey + scoreCommitment
        └───────┬──────────┘
                │ proof request
                ▼
     ┌────────────────────────┐        ┌──────────────────────────────┐
     │ proof-server :6300      │─submit─▶│ Midnight condition-registry   │
     │ (local Docker)          │        │  entries: Map<Field, Entry>   │
     └────────────────────────┘        │  public: entryKey, periodStartMs,
                │                        │  recordedAt, scoreCommitment, band
                │ tx result               │  private: the 0–100 value, nonce
                ▼                        └──────────────┬───────────────┘
     ┌────────────────────────┐                        │ indexer query
     │ libSQL / SQLite         │                        │
     │  rings /                │        ┌───────────────▼───────────────┐
     │  ring_worker_map /      │        │ read API (apps/gateway)        │
     │  workers / worker_pii / │◀──────▶│  token auth → resolve scope →  │
     │  condition_readings /   │        │  compute entryKeys →           │
     │  submissions            │        │  read the bands                │
     └────────────────────────┘        └───────────────┬───────────────┘
                                                          │
                              ┌─────────────────────────┴─────────────────────┐
                              ▼                                               ▼
                        worker (self)                                  admin (all)
```

### Trust boundaries

| Component | Assumption |
|---|---|
| Partner company | The computed value is correct (unsigned today; a partner signature would strengthen this) |
| Admin (server / DB owner) | The onboarding root — creates rings and workers and pairs them. Trusted to keep the roster right and to submit the partner's value **unmodified**. The chain guarantees no-tampering-after-submission and non-repudiation, not source authenticity at submission time |
| Worker attribution | **An operator claim, not a cryptographic binding.** The chain carries only `entryKey` + band + commitment; which ring or worker an entry belongs to comes from the operator's DB |
| Login tokens | A demo shape: the token *is* the worker id, with `admin` as the one fixed string. No passwords, no sessions. Production would replace this with OIDC |
| Salt holder | Can brute-force a ring's history. The salt is disclosed at audit time (`salt_epochs` records each generation's hash so a rotation stays verifiable) |
| Band disclosure | Pseudonymous and world-readable. The raw 0–100 never appears |

### 2.1 Run modes

The ingester and the gateway's Node entrypoint can run with or without a chain
(`MIDNIGHT_NETWORK` unset just disables submit/reconcile, returning 501). The
`run.sh` Docker harness, however, only exposes the on-chain mode for the
dashboard — `./run.sh e2e` is the single command that brings up the devnet,
deploys the contract and serves the dashboard joined to it. There is no
standalone `dashboard` lane and no seeded/offline demo lane.

**Ingester, offline (no chain)** — `./run.sh db` / `ingester record --local`:

```
rings / ring_worker_map /       roster — empty at first; the admin builds it in the
workers / worker_pii            Data admin screen (tests load sample-roster.sql)
condition_readings              stands in for the partner API — empty at first
                                (tests load sample-feed.sql; the dashboard's
                                 submit form needs a chain and returns 501 here)
      │
      ▼
apps/ingester   plan → record --local        the real work is in ingester-core:
      │                                       periodStartMs / entryKey / commitment / band
      ▼
submissions table               band is written; tx_id / tx_hash / block_height /
      │                         chain_verified_at stay NULL
      ▼
gateway serve  (:8787, one origin)
  ├─ GET /api/*   read API — dbConditionReader over the submissions table (verified:false)
  └─ GET /        dashboard SPA
```

Storage is a local SQLite file (`data/ingester-local.db`, no `LIBSQL_URL`) or the
docker libSQL server (`./run.sh db`). No `midnight-node`, no proof server, no
wallet. The only required env var is `INGESTER_SALT_HEX`. `gateway serve`
(`npm run dashboard:dev`, a Node host) can still front this with the dashboard
SPA; the verify button then returns **501** (`POST /api/reconcile` has no chain
to check against). The `run.sh` harness does not expose this mode at all — its
only dashboard-serving lane, `e2e`, always joins the devnet (below).

**Local devnet (on-chain)** — `./run.sh e2e`:

```
condition_readings ─▶ ingester loadAndPlan ──▶ condition-cli  submit / deploy / fund / reconcile
 (db:seed)            (the same plan as offline)  │        (@midnight-demo/midnight-chain +
                                                  │         one operating wallet, funded from
                                                  │         the devnet genesis seed — not a faucet)
                                                  ▼
                   proof-server :6300  ──proof──▶ midnight-node :9944  ──▶ condition-registry
                                                        │                   (Map<Field, Entry>)
                                    indexer-standalone :8088                       │
                                                  │                               │
  submissions table ◀── reconcileSubmissions ─────┴── read each entry back ────────┘
      │                (overwrite the band, stamp chain_verified_at)
      ▼
  gateway serve :8787  (joined to the devnet)
      └─ /api/* now reports verified:true; the verify button hits the real contract

  All of it via ops/local/midnight-compose.yml (bound to 127.0.0.1 only)
```

Real `midnight-node` 1.0.0 / `indexer-standalone` 4.3.3 / `proof-server` 8.1.0 in
Docker. This is the only mode where `submissions` rows carry a real `tx_id` /
`tx_hash` / `block_height` and a `chain_verified_at`.

---

## 3. Roles and authorization

Two roles, and no scope machinery — there is only one worksite.

| Role | enum | Token | Sees |
|---|---|---|---|
| 管理者 admin | `admin` | `admin` | Every worker's band history, the Data admin screen, chain reconciliation |
| ユーザー worker | `worker` | their worker id | Their own history only — **including the raw 0–100 value** |

**Authentication is the token itself** (`apps/gateway/src/auth.ts`):

```
Authorization: Bearer <token>
   token === 'admin'       → admin
   otherwise               → looked up as workers.id; that worker, or 401
```

There is no users table and no `role_assignments`. This is deliberately minimal
for a demo; production would swap it for OIDC / sessions.

**Only the worker sees their own raw value.** The admin does not —
`attachOwnConditionValues` in `apps/gateway/src/routes.ts` runs only when
`viewer.role === 'worker'`.

---

## 4. Data model

### 4.1 On-chain (`condition-registry` contract state)

```
export enum ConditionBand { unclassified, danger, caution, normal }

export struct ConditionEntry {
    periodStartMs: Uint<64>;     // epoch ms of that day's 00:00 in APP_TIME_ZONE
    recordedAt: Uint<64>;        // when the reading was actually taken
    scoreCommitment: Bytes<32>;  // persistentCommit(scoreCenti, nonce)
    band: ConditionBand;
    verified: Boolean;
}

export ledger entries: Map<Field, ConditionEntry>;
export ledger submissionCount: Counter;
export ledger lastSubmittedKey: Field;
export ledger lastSubmittedBand: ConditionBand;
```

**How `entryKey` is built** (`conditionEntryKey` in `packages/shared/src/condition.ts`):

```
entryKey = first 31 bytes of SHA-256( utf8(ringId) || be_u64(periodStartMs) || salt )
```

- Truncated to 31 bytes so it fits a Midnight `Field`.
- `salt` is `INGESTER_SALT_HEX` (≥16 bytes). **It never reaches the browser.**
- Keyed by **ring id**, not worker id, so an on-chain identifier cannot be walked
  back to a person.
- Without the salt, a third party cannot tell which entry belongs to which ring.

### 4.2 Off-chain DB (`@midnight-demo/db`)

libSQL (a local SQLite file or the docker libSQL server). The schema is the
single file `packages/db/migrations/0001_condition_schema.sql`.

#### Rings and workers

```
rings             (id, label, owner_label, status, created_at)
ring_worker_map   (ring_id, worker_id, from_ts, to_ts?)

workers           (id, created_at)
worker_pii        (worker_id, name)
```

- `rings.id` is the on-chain identity (the `entryKey` preimage); `label` is the
  ring's display name, required at creation — there is no separate serial or
  device-pairing concept.
- `ring_worker_map` says who is wearing it. One ring : one worker : one day.
- `workers` holds only identifiers; names are split into `worker_pii`.
- `workers.id` doubles as the login token.

#### Conditions

```
condition_readings   (id, ring_id, recorded_at, value, source, entered_by?,
                      status, skip_reason?, created_at)

submissions          (entry_key, ring_id, period_start_ms, timezone, recorded_at_ms,
                      band, score_commitment_hex, salt_ref?, deployment_id?, submitted_by?,
                      tx_id?, tx_hash?, block_height?, submitted_at, chain_verified_at?, reconciled_at?)

salt_epochs          (id, salt_hash, from_ms, to_ms?, created_at)
contract_deployments (id, network, address, deployed_at, active)
audit_log            (id, actor_user_id?, action, target_table, target_id, before_json?, after_json?, ts)
```

- `condition_readings` is where the partner feed lands. In this build it is
  written as a side effect of the Data admin screen's one-shot submit form
  (`source = 'manual'`), not staged separately.
- `submissions` is **the ingester's local copy of the on-chain entries** — one row
  per `(ring, local day)`, keyed by the on-chain `Map` key. The read API serves
  bands from here rather than querying the chain on every request.
- `chain_verified_at` is stamped by `reconcileSubmissions` once the row has been
  read back from the chain and agrees. It drives the dashboard's
  "⚠ pending / ✓ verified" indicator.
- `salt_epochs` stores only each generation's **hash**. The live salt is never in
  the DB.

#### How the timezone is held

One worksite means one timezone: **`APP_TIME_ZONE`** (`Asia/Tokyo`) in
`packages/shared/src/period.ts` is the authority.

- `submissions.timezone` — which zone was used at submission time, so changing
  the constant cannot silently reinterpret past rows.
- `submissions.period_start_ms` — the 00:00 that was actually computed.

`zonedDayStartMs(instantMs, timeZone)` derives the offset via
`Intl.DateTimeFormat`, so DST is handled.

### 4.3 Private state (ingester)

The raw `scoreCenti` and its `nonce` are kept in Midnight's encrypted private
state (passphrase: `DEVELOPMENT_PRIVATE_STATE_PASSWORD`), never in the DB. They
are the material for a later commitment-opening proof.

---

## 5. `condition-registry` contract

**One circuit, one value.** `submitCondition` takes public inputs `(entryKey,
periodStartMs, recordedAt, scoreCommitment)`, reads the raw `scoreCenti` and
`nonce` as private witnesses, checks the commitment, derives the three-state band
and inserts one `ConditionEntry` — one `(ring, day)` per call.

### 5.1 Witnesses

```
witness privateScoreCenti(entryKey: Field): Uint<32>;   // round(value × 100), 0..10000
witness privateScoreNonce(entryKey: Field): Bytes<32>;
```

### 5.2 Circuit `submitCondition`

```
export circuit submitCondition(
    entryKey: Field,
    periodStartMs: Uint<64>,   // epoch ms of that day's 00:00 (same value the entryKey used)
    recordedAt: Uint<64>,      // when the reading was taken (epoch ms)
    scoreCommitment: Bytes<32>
): [] {
    const key = disclose(entryKey);
    assert(!entries.member(key), "entry already submitted for this ring/day");

    // is the reading inside the day it claims? (108000000 ms = 30h)
    const windowEnd = (periodStartMs + 108000000) as Uint<64>;
    assert(recordedAt >= periodStartMs, "recordedAt is before the period day");
    assert(recordedAt < windowEnd, "recordedAt is after the period-day window");

    const scoreCenti = privateScoreCenti(key);
    const nonce = privateScoreNonce(key);
    assert(
        disclose(persistentCommit<Uint<32>>(scoreCenti, nonce) == scoreCommitment),
        "score commitment mismatch"
    );

    // 6000 = 60 points, 4000 = 40 points
    const band = disclose(
        scoreCenti >= 6000
            ? ConditionBand.normal
            : (scoreCenti >= 4000 ? ConditionBand.caution : ConditionBand.danger)
    );

    entries.insert(key, disclose(ConditionEntry {
        periodStartMs: periodStartMs,
        recordedAt: recordedAt,
        scoreCommitment: scoreCommitment,
        band: band,
        verified: true
    }));
    submissionCount.increment(1);
    lastSubmittedKey = key;
    lastSubmittedBand = band;
}
```

The 30-hour window tolerates night shifts and readings that cross midnight while
still rejecting a value that plainly belongs to another day.

### 5.3 What integrity does and does not cover

**Guaranteed:**
- `band` is correctly derived from the value committed in `scoreCommitment` — the
  band's correctness is provable without revealing the value.
- A duplicate `(ring, day)` is rejected (`assert(!member)`).
- After submission, `band` and `scoreCommitment` cannot be altered.

**Not guaranteed:**
- That the submitted `scoreCenti` is the partner's actual computed value (this is
  trust in the ingester / operator; verifying a partner signature inside the
  circuit would close it).
- That every ring and every day was submitted — a gap is simply no entry.

### 5.4 Circuit tests

`contracts/condition-registry/src/test/condition-registry.test.ts` (Vitest, 10 cases):

- accepts valid values and derives `normal` / `caution` / `danger` correctly
- rejects a re-submission of the same `entryKey`
- rejects a `scoreCommitment` mismatch (tampered value or nonce)
- boundaries (60→normal / 59→caution / 40→caution / 39→danger)
- rejects a `recordedAt` outside the 30h day window (before and after)
- the on-chain `ConditionEntry.periodStartMs` matches the input

`./run.sh test_contract` compiles (Compact 0.31.1) and runs them.

---

## 6. Ingester

Three packages plus a CLI:

- **`packages/ingester-core`** — pure logic, no Midnight SDK and no DB: types,
  `periodStartMs` resolution, planning (entryKey / scoreCommitment / band,
  idempotency). Unit-tested offline.
- **`apps/ingester`** — the orchestration CLI (`plan` = dry run, `record --local`
  = write to `submissions`) plus `db.ts`. `boundary.test.ts` enforces that it
  **never imports the Midnight SDK**.
- **`packages/midnight-chain`** — the SDK layer: operating wallet, providers,
  `submitCondition` (tx + encrypted private state), `deployConditionRegistry`,
  the real `indexerConditionReader`, and `reconcileSubmissions`.
- **`apps/development/condition-cli`** — the CLI over it:
  `deploy` / `submit` / `reconcile` / `status` / `fund` / `wallet` / `funding`.

### 6.1 Flow

```
1. Load roster   rings                                →  (ringId, timezone=APP_TIME_ZONE)
2. Load feed     condition_readings                    →  (ringId, recordedAt, value)
3. Plan (ingester-core)
     periodStartMs   = zonedDayStartMs(recordedAt, timezone)
     scoreCenti      = round(value * 100)         … outside 0..10000 → skip
     nonce           = 32 random bytes
     scoreCommitment = persistentCommit(scoreCenti, nonce)
     entryKey        = sha256(ringId || be_u64(periodStartMs) || salt)[0..31]
     band            = classifyCondition(value)
     skip if that entry_key is already in submissions (idempotent)
4. Submit        condition-cli submit → proof → tx → chain
5. Record        INSERT into submissions (with tx_id / tx_hash / block_height)
6. Reconcile     reconcileSubmissions → read back → stamp chain_verified_at
```

Three skip kinds:

| kind | Meaning |
|---|---|
| `unknown-ring` | a value arrived for a ring that is not in the roster |
| `invalid-value` | outside 0–100 |
| `already-submitted` | that `(ring, day)` is already on chain |

### 6.2 Transaction granularity

One ring × one day = one transaction; no batching. Two reasons:

- one failure does not take the others down, so partial failure stays simple;
- the contract's `assert(!entries.member(key))` doubles as retry safety.

---

## 7. Read path

### 7.1 Authorization is off-chain

The chain does not know who may read (bands are world-readable). The read API
(`apps/gateway`) carries authorization.

```
Authorization: Bearer <token>
        │
        ▼
authenticate()          token → Viewer{role, workerId} (admin is a fixed string)
        │
        ▼
resolveRingScope()      admin  → every ring
                        worker → the rings mapped to them in ring_worker_map
        │
        ▼
conditionHistory()      per ring × per day → compute entryKey → reader.read(entryKey)
        │                (only the server holds the salt)
        ▼
JSON                    { range, rings: [{ ringId, timezone,
                                           workerId, workerName, entries: [...] }] }
```

The salt never reaches the browser, so a client cannot construct an `entryKey`
itself and can only read what the server hands it.

### 7.2 API

| Method / path | Who | What |
|---|---|---|
| `GET /api/config` | no auth | display strings (network name, explorer URL, submit availability) |
| `GET /api/me` | any | the caller's role and name |
| `GET /api/conditions/mine` | any | the caller's whole resolved scope |
| `GET /api/conditions/all` | admin | every ring |
| `GET /api/conditions/worker/:id` | admin, self | that worker's rings |
| `POST /api/reconcile` | any (within scope) | re-check the given `entryKeys` against the chain |
| `GET/POST/PATCH/DELETE /api/{rings,workers}` | admin | roster CRUD |
| `GET /api/roster` | admin | the joined roster for the Data admin screen |
| `GET/POST/PATCH/DELETE /api/staged[/:id]` | admin | the `condition_readings` feed |
| `POST /api/staged/submit` | admin | submit every pending reading on-chain (devnet) |
| `POST /api/submit` | admin | submit one ad-hoc reading on-chain (devnet) |

`from` / `to` query parameters bound the range (default: the last 30 days).
The `/api/staged*` endpoints have no UI in the dashboard — the Data admin
screen's submit form calls `/api/submit` directly, one reading at a time.

### 7.3 Dashboard

`apps/dashboard/public/` — a build-free, framework-free SPA (`index.html` +
`app.js` + `styles.css`) with a ja/en toggle.

| Screen | admin | worker |
|---|:-:|:-:|
| Today — a worker card per person with the day's band | ● | — |
| Today (self) — the day's band **plus the raw value**, and a month table | — | ● |
| List — filter by range and worker, entryKey / tx columns, CSV export, verify | ● | — |
| Data admin — rings and workers CRUD, one-shot on-chain submit | ● | — |

- Login is a pasted token: a worker uses their own id (`worker-1`), staff use
  `admin`.
- The verify button calls `POST /api/reconcile`. Against a devnet it really reads
  the entry back and updates `chain_verified_at`. If the bands disagree, **the
  chain wins** — the local row is corrected and the mismatch is reported.

### 7.4 Independent verification

An admin can verify at two levels:

1. **Band reconciliation** — the verify button. Compares `submissions.band` with
   the chain's `entries`. Tampering with the local copy shows up here.

   Reconciliation is **two-phase** (`reconcileSubmissions` with `phased: true`).
   For a row whose `reconciled_at` is still NULL, the first call stamps
   `chain_verified_at` / `reconciled_at` from the stored record and returns
   `localChecked` without reading the chain; only once `reconciled_at` is set does
   the next call open an `indexerConditionReader` and query the chain directly.
   **Detecting a mismatch therefore takes two presses** — which is why the first
   toast reads "press again to check the chain directly".
2. **Opening the commitment** — given the salt and a `(scoreCenti, nonce)`
   disclosure, recompute `persistentCommit(scoreCenti, nonce) == scoreCommitment`
   and `entryKey == sha256(ringId || periodStartMs || salt)[0..31]`. That
   establishes the on-chain band really was derived from that value, without
   trusting the operator's server.

The Data admin screen has a "tamper the local record" checkbox that deliberately
desynchronises the DB from the chain, so the reconcile detection can be
demonstrated.

---

## 8. Privacy summary — what appears where

| Data | Chain | Server DB | admin | worker (self) |
|---|:-:|:-:|:-:|:-:|
| Raw 0–100 value | — | ○ (`condition_readings`) | — | ○ |
| Band (normal/caution/danger) | ○ | ○ | ○ | ○ |
| `scoreCommitment` | ○ | ○ | ○ | — |
| `entryKey` | ○ | ○ | ○ | — |
| Name | — | ○ (`worker_pii`) | ○ | ○ |
| Ring id | — | ○ | ○ | ○ |
| Salt | — | hash only | disclosable | — |

**The chain alone identifies nobody.** It carries a salted-hash `entryKey` with a
band, a commitment and timestamps. Without the salt, an observer cannot even tell
which entries belong to the same person.

---

## 9. Repository layout

```
run.sh / run.ps1 / run.bat      one-command Docker harness (tests, dashboard, devnet, end-to-end)
contracts/condition-registry/   Compact contract: submitCondition + witnesses + circuit tests
packages/shared/                commitments, band vocabulary, timezone math, hex utils
packages/db/                    SqlDatabase (libSQL), schema, migrations, local seed
packages/ingester-core/         pure ingest logic: types, timezone math, planning, idempotency
packages/condition-read/        read side: scope resolution, band-history assembly, ConditionReader
packages/midnight-chain/        Midnight SDK layer: wallet, providers, submit, deploy, reconcile
apps/ingester/                  ingester CLI: read roster + feed from the DB, build submissions
apps/gateway/                   authorized read API + the local Node server (also serves the SPA)
apps/development/condition-cli/ on-chain CLI: deploy / submit / status / fund / …
apps/dashboard/public/          framework-free SPA
ops/local/                      docker-compose for the libSQL server and the Midnight devnet
docs/ , docs/ja/                English docs and Japanese translations
```

---

## 10. Running it

Everything goes through `run.sh` (`run.ps1` / `run.bat` on Windows). The host
needs Docker and nothing else — no Node.

```bash
./run.sh test           # SDK-free unit tests + typecheck (fast)
./run.sh test_sdk       # typecheck + tests for the Midnight-SDK workspaces
./run.sh test_contract  # compile condition-registry + its ZK-circuit tests
./run.sh test_all       # all three
./run.sh db             # ingester end-to-end against a docker libSQL server
./run.sh devnet         # bring up the local Midnight devnet
./run.sh e2e            # ONE COMMAND: devnet → fund → deploy → dashboard on :8787
./run.sh down           # stop (clean = also drop the volumes)
```

`./run.sh e2e` is the single entry point for the dashboard — there is no
standalone `dashboard` lane. `RESUME=1 ./run.sh e2e` skips fund/deploy and
reuses the existing devnet deployment; use it to restart just the dashboard
container without redeploying the contract.

The only required setting is `INGESTER_SALT_HEX` in `.env` (hex, ≥16 bytes). Copy
`.env.example` to start.

---

## 11. Open questions and future work

- **Partner signature** — the provenance of the value rests on trusting the
  operator. Signing the value at the partner and verifying that signature inside
  the circuit would remove the operator from the trust base.
- **Salt rotation** — `salt_epochs` is in the schema, but the rotation procedure
  is not implemented.
- **Missing days** — a day with no reading is simply absent. This build does not
  distinguish "on site but not wearing the ring" from "not working".
- **Multiple worksites** — one site is assumed. Supporting several would mean
  reintroducing a sites table and ring/worker site assignment.
- **Authentication** — token-as-worker-id is a demo shortcut: anyone who types
  another worker's id reads as them. Production needs OIDC / sessions.
