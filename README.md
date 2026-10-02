# OHAYO!

**Worker condition, recorded on-chain — one 0–100 value a day, only the band disclosed.**

Built for the **Midnight Buildathon**, Track 1: Build Privacy-First Apps on Midnight.

[日本語版](docs/ja/README.md) · [Design & spec](docs/worksite_condition_system.md) ([日本語](docs/ja/worksite_condition_system.md))

---

## The problem

Construction sites are required to manage worker health, and heatstroke
countermeasures on Japanese sites are now a legal obligation rather than a
recommendation. Smart rings can supply a daily physical-condition score, but that
score is **sensitive, medical-adjacent data**. Two forces pull in opposite directions:

- A regulator or a general contractor needs a record that **cannot be rewritten
  after an accident**. A signed database proves little once the company that
  signed it is the one under investigation.
- A worker must not have their daily biometric score published, or made visible
  to every manager in the contracting chain.

Put the record on a public chain and you solve the first while destroying the
second.

## What OHAYO! does

A partner company computes one **0–100 condition value per worker per day**.
OHAYO! takes it from there and puts **only the three-state band** on Midnight:

| Value | Band | Meaning |
|---|---|---|
| 60–100 | `正常` normal | fit to work |
| 40–59 | `要注意` caution | monitor |
| 0–39 | `危険` danger | intervene |

The raw value never leaves the operator's machine. What lands on chain is a
salted-hash key, the band, and a commitment to the value — plus a ZK proof that
the band really was derived from the committed value.

**This is the part that only works on Midnight.** The circuit reads the raw score
as a private witness, checks it against a public commitment, derives the band, and
writes only the band to the public ledger. Anyone can verify the band is honest;
nobody can read the score.

```
private witness             public ledger
──────────────────          ───────────────────────────────────────
scoreCenti  (7800)  ──┐
nonce       (32B)   ──┼─▶ commitment check ─▶ band = normal ─▶ entries[entryKey]
                      │                                          { periodStartMs,
                      └─ never leaves the prover                    recordedAt,
                                                                    scoreCommitment,
                                                                    band, verified }
```

The key is `sha256(ringId ‖ periodStartMs ‖ salt)` — keyed by **ring**, not by
person, and salted. Without the salt an observer cannot even tell which on-chain
entries belong to the same worker.

---

## Quick start

The only prerequisite is **Docker**. No Node, no accounts, no cloud.

```bash
cp .env.example .env   # run.sh only checks that this file exists; defaults do the rest
./run.sh e2e           # devnet → fund → deploy → dashboard on :8787
```

One command brings up a real local Midnight devnet (`midnight-node` 1.0.0,
`indexer-standalone` 4.3.3, `proof-server` 8.1.0), funds an operating wallet from
the genesis seed, compiles and deploys the contract, and serves the dashboard
joined to it. The dashboard always runs against a real deployed contract — there
is no offline/sample-data mode.

Then open <http://localhost:8787> and log in:

| How | Role | Sees |
|---|---|---|
| **Lace で接続してログイン** with a wallet whose key hash is in `ADMIN_WALLET_KEY_HASHES` | 管理者 admin | every worker, plus the Data admin screen and chain reconciliation |
| the same button, with the invite code the admin issued (first time only) | ユーザー worker | their own history — **including the raw 0–100 value** |
| **ゲストとして試す** (on by default locally; `GUEST_ENTRY=0` turns it off) | a sandbox worker, switchable to admin | their own worker and ring |

Login signs a one-time challenge with the wallet (no fee); the first attempt with an
unregistered wallet shows its key hash for `ADMIN_WALLET_KEY_HASHES`.

The roster starts empty — create a ring and a worker (id `worker-1`) from
データ管理 as `admin` and assign the ring. Log in as `worker-1` and send a score
(0–100) from the **リング同期** card; it goes straight to the partner mock, not to
OHAYO! Back as `admin`, press **パートナーから取得** and then **チェーンへ送信** —
this proves and submits a real transaction. The verify button in the UI
reconciles the local copy against the deployed contract for real.

The header toggles Japanese / English. `./run.sh down` stops everything.
`RESUME=1 ./run.sh e2e` skips fund/deploy and reuses the existing deployment.

From cmd.exe or PowerShell use `run.bat <lane>` or `.\run.ps1 <lane>` — a native
port that drives Docker directly, no Git Bash or WSL.

---

## Tests

```bash
./run.sh test_all     # everything below
```

| Lane | What it covers |
|---|---|
| `./run.sh test` | 101 unit tests + `tsc --noEmit` across the seven SDK-free workspaces |
| `./run.sh test_sdk` | typecheck + tests for the Midnight-SDK workspaces |
| `./run.sh test_contract` | compiles `condition-registry` with Compact 0.31.1 and runs 15 ZK-circuit tests in the simulator |
| `./run.sh db` | the ingester end-to-end against a real libSQL server container |

The circuit tests cover the honest path for all three bands, the band boundaries
(60/59/40/39), rejection of a duplicate `entryKey`, rejection of a tampered
`scoreCommitment` (both value and nonce), and rejection of a `recordedAt` outside
the day window. The read-side tests cover every role's scope in both the allowed
and the forbidden direction.

Every lane runs inside a throwaway `node:22-bookworm` container, so a fresh
checkout on a machine with only Docker reproduces them exactly.

---

## How it is built

```
run.sh / run.ps1 / run.bat      one-command Docker harness
contracts/condition-registry/   Compact contract: submitCondition + witnesses + circuit tests
packages/shared/                commitments, band vocabulary, timezone math, hex utils
packages/db/                    SqlDatabase (libSQL, D1), schema, migrations, sample fixtures
packages/ingester-core/         pure ingest logic: types, timezone math, planning, idempotency
packages/condition-read/        read side: scope resolution, band-history assembly
packages/midnight-chain/        Midnight SDK layer: wallet, providers, submit, deploy, chain reads
apps/ingester/                  ingester CLI + DB side of submit / reconcile — SDK-free (boundary.test.ts)
apps/gateway/                   authorized read API + the local Node server (also serves the SPA)
apps/development/condition-cli/ on-chain CLI: deploy / submit / reconcile / status / fund
apps/dashboard/public/          framework-free SPA (no build step)
ops/local/                      docker-compose for the libSQL server and the Midnight devnet
docs/ , docs/ja/                design docs, English and Japanese
```

**Dual-ledger split.** `privateScoreCenti` / `privateScoreNonce` are witnesses;
the raw score and its nonce live in Midnight's encrypted private state and are
never written to the database. The public ledger holds `entries: Map<Field,
ConditionEntry>` plus counters. `packages/midnight-chain` is the only workspace
that touches the SDK — `apps/ingester` and `apps/gateway` stay SDK-free and
WASM-free, and a test enforces that boundary.

**Local copy, chain as the authority.** The read API serves bands from a
`submissions` table so the dashboard is fast, and `reconcileSubmissions` re-reads
each entry from the chain to stamp `chain_verified_at`. When the two disagree,
**the chain wins** and the local row is corrected. The Data admin screen's submission
queue has a "tamper the local record" checkbox that deliberately desynchronises
them, so the detection can be demonstrated live.

Full detail — data model, circuit spec, trust boundaries, privacy matrix — is in
[docs/worksite_condition_system.md](docs/worksite_condition_system.md).

---

## Who it is for

**Primary users:** general contractors (元請) running sites under Japan's
Industrial Safety and Health Act. They already collect health-check data; what
they lack is a record a regulator will accept without auditing their servers.

**Adoption path.** The partner-computed value is a database table today and an
HTTP source tomorrow — the swap point is a single interface (`ConditionSource`).
A site can adopt the ingest and read path before committing to a chain rollout,
then turn on chain submission later without changing either path. (This
Buildathon build always runs against a real deployed contract — see *Quick
start* above; the phase-in described here is an architectural property, not a
mode this build exposes.) Smart-ring vendors and
site-management SaaS are the natural distribution channels; the tamper-evident
record is the piece they cannot build themselves.

**Beyond construction.** The same shape — a private score, a public band, a
salted per-device key — fits logistics driver fatigue, factory shift safety, and
any regulated setting where a threshold must be auditable while the measurement
must stay private.

## Roadmap

| Stage | Scope |
|---|---|
| Now | Contract + ZK tests, ingester, role-scoped read API, dashboard, local devnet end-to-end; the contract is deployed on Midnight preprod ([runbook](docs/deploy_preprod.md)); hosting on Cloudflare workers.dev with on-demand containers is built ([runbook](docs/deploy_cloudflare.md)) |
| Next | Partner HTTP source in place of the manual feed; salt rotation on the `salt_epochs` schema already in the DB |
| Then | **Partner-signed values verified inside the circuit** — removes the operator from the trust base, the one remaining gap in the threat model |
| Later | Hosted demo on the preprod contract; a worker-facing mobile view; site-level aggregate statistics proven in ZK without per-worker disclosure |

---

## Configuration

Copy [.env.example](.env.example) to `.env` (git-ignored) — `run.sh` only checks
that the file exists, and passes its own development defaults for
`MIDNIGHT_NETWORK`, `INGESTER_SALT_HEX` and `DEVELOPMENT_PRIVATE_STATE_PASSWORD`
into the container, so no edits are needed for the Docker harness.
`MIDNIGHT_GENESIS_SEED` needs no default at all: `packages/midnight-chain` falls
back to the well-known devnet genesis seed whenever it's unset. Running the
individual `npm run condition:*` scripts directly on a Node host (bypassing
`run.sh`) does read `.env` for real; set `MIDNIGHT_NETWORK=local` there first.

`.env` also accumulates the generated operating wallet mnemonic and the deployed
contract address once you run the devnet lanes. **Back it up; never commit it.**

## License

Apache License 2.0 — see [LICENSE](LICENSE) and [NOTICE](NOTICE).

Built on [Midnight](https://midnight.network/). The local devnet compose file is
adapted from `midnightntwrk/midnight-local-dev`.
