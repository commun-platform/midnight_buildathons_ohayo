# Repository Guidelines

## Project Structure & Module Organization

**SADAKO** is an npm-workspaces monorepo that records a partner-computed worksite
worker-condition value on Midnight and serves a role-scoped band view. Everything
runs locally — a local libSQL/SQLite database and a local Midnight devnet; there
is no cloud deployment target. It separates runtime responsibilities:

- `packages/midnight-chain/` + `apps/development/condition-cli/`: the Midnight SDK layer — one operating-gateway wallet (persistent `@polkadot` submission service), providers, `submitCondition` (tx + encrypted private state), `deployConditionRegistry`, `submitReadings` / `readConditionEntries` behind the `conditionChain(network, address)` port, and the real `indexerConditionReader`. It never touches the database — it does not depend on `@midnight-demo/db` (`apps/gateway/src/boundary.test.ts`). `condition-cli` is the CLI (`deploy` / `submit` / `reconcile` / `status` / `fund` / `wallet` / `funding`). Needs Node + the SDK; `run.sh e2e` runs the full fund → deploy → submit → reconcile → status loop against `run.sh devnet` in Docker. A `local` profile targets `ops/local/midnight-compose.yml`.
- `apps/ingester/` + `packages/ingester-core/`: worksite condition ingester — read the roster + condition feed from the DB (`rings`, `ring_worker_map`, `condition_readings`), resolve `periodStartMs`, build `condition-registry` submissions with idempotency (`ingester-core` is the pure, offline-tested logic: types, planning, and the `ConditionChain` port). `apps/ingester` stays Midnight-SDK-free and exposes `./db` / `./pipeline`, plus `./store` / `./submit` / `./reconcile` — the DB side of submitting and reconciling, which drives any `ConditionChain` and is shared by the Node gateway and the hosted Worker (`boundary.test.ts` enforces this).
- `apps/partner-mock/`: the partner company's stand-in — a fetch-style handler (`POST /v1/measurements`, signed `GET /v1/daily-scores` with a cursor, `POST /v1/simulate`) over its own database, Ed25519-signing every score. `run.sh e2e` runs it as `mn-condition-partner` on :8788. API: `docs/partner_mock_api.md`. `apps/ingester/src/partner.ts` (`pullPartnerScores`, `npm run ingest:pull`) verifies and queues its scores.
- `apps/gateway/` + `packages/condition-read/`: authorized read API — role-scoped band history, plus the local Node server that also serves the SPA (`npm run dashboard:dev`). No Midnight-SDK dependency and no WASM in the request path. The reader is `dbConditionReader`: the band lives in the `submissions` table, the ingester's chain-confirmed local copy of the on-chain entries (kept in step via `reconcileSubmissions` — `@midnight-demo/ingester/reconcile` over the chain port, `npm run condition:reconcile`). `apps/gateway/src/boundary.test.ts` walks the value-import graph of the Worker-facing modules and fails if it reaches the Compact runtime, the Midnight SDK, libSQL, or a Node built-in.
- `contracts/condition-registry/`: worksite condition contract (`submitCondition`), witnesses, and simulator tests. Toolchain pinned by `.compact-version` (0.31.1).
- `packages/db/`: `SqlDatabase` with a libSQL adapter and a Cloudflare D1 adapter (`@midnight-demo/db/d1`, ported from the BACCHIRI `D1SqlDatabase`), condition-system schema + migrations + the opt-in `sample-roster.sql` / `sample-feed.sql` fixtures. Used by the ingester and the gateway.
- `packages/shared/`: condition band vocabulary, `conditionEntryKey` (WebCrypto), timezone math, hex utils, and unit tests — all Worker-safe. `conditionScoreCommitment` (`persistentCommit`, Compact-runtime WASM) is only under `@midnight-demo/shared/commitment`.
- `apps/dashboard/public/`: framework-free SPA (`index.html` + `app.js` + `styles.css`, no build). Paste-token login (the token is the worker's id, or `admin`), role-scoped worker list, per-worker band history (day strip + table), CSV export, ja/en. Served by `npm run dashboard:dev` (= `gateway serve`) together with `/api/*` same-origin. Data: `/api/config`, `/api/me`, `/api/conditions/*`.
- `docs/`: canonical English guidance; Japanese translations live in `docs/ja/`. `docs/worksite_condition_system.md` is the current spec.

Generated `dist/`, `.state/`, `data/`, and `contracts/condition-registry/src/managed/` content is gitignored. Do not hand-edit generated Compact artifacts.

## Roles

Two roles, no scope machinery — one worksite is assumed and there is no site
concept. `admin` (管理者 — every worker, the Data admin screen, and chain
reconciliation) and `worker` (ユーザー — their own history, including the raw
0–100 value nobody else sees).

Authentication is the bearer token itself (`apps/gateway/src/auth.ts`): `admin`
is a fixed string, anything else is looked up as a `workers.id`. There is no
users table and no `role_assignments`. The day boundary comes from
`APP_TIME_ZONE` in `packages/shared/src/period.ts`.

## Build, Test, and Development Commands

- `npm install`: install all workspace dependencies.
- `npm test` / `npm run typecheck` / `npm run verify`: full suite on a real development host (Node + Compact tools).
- Via Docker (host has no Node) — `run.sh` at the repo root (bash: Git Bash / WSL); `run.ps1` is a native Windows port (no Git Bash) and `run.bat` is its cmd shim — same lanes. `.claude/skills/sadako-demo/SKILL.md` documents the demo script and the lanes in detail. Pass the lane as `$1`, or set `MODE_ENV` in the shell or in `.env` / `.env.local` (`RESUME` too; positional arg and a shell value win).
  `run.sh test` (SDK-free unit + typecheck), `run.sh test_sdk` (midnight-chain / condition-cli), `run.sh test_contract` (compile condition-registry + ZK tests), `run.sh test_all` (the three combined),
  `run.sh db` (ingester vs a docker libSQL server), `run.sh devnet` (local Midnight devnet),
  `run.sh e2e` (ONE COMMAND: devnet → fund → deploy → dashboard on :8787, joined to the deployed contract; no standalone `dashboard` lane and no offline/seeded mode — `RESUME=1 run.sh e2e` restarts just the dashboard), `run.sh deploy_preprod [wallet|funding|deploy|status]` (deploy `condition-registry` to Midnight preprod with the wallet in the git-ignored `.env.preprod`; runbook `docs/deploy_preprod.md`), `run.sh down` / `clean`.
- `npm run db:up` / `npm run db:down` / `npm run db:seed:sample` (`sample-roster.sql` + `sample-feed.sql`): local libSQL server (`ops/local/docker-compose.yml`). The roster is otherwise operator-built via the dashboard Data admin screen; the feed is that screen's Submission queue — workers send scores to the partner mock from their ring sync card, and the admin pulls them (`POST /api/partner/pull`, `npm run ingest:pull`) and submits them (needs a live chain); fixtures can also load it. The admin never enters a score on screen.
- `npm run midnight:up` / `npm run midnight:down`: local Midnight devnet (`ops/local/midnight-compose.yml`).
- `npm run ingest:plan` / `npm run ingest:record`: worksite ingester dry-run / record to the `submissions` table (offline).
- `npm run ingest:submit` (= `condition:submit`): plan + submit on-chain via `apps/development/condition-cli` (Midnight SDK + funded wallet).
- `npm run condition:deploy` / `condition:reconcile` / `condition:status` / `condition:fund` / `condition:wallet` / `condition:funding`: deploy `condition-registry`, re-confirm the `submissions` local copy against the chain, read the ledger, fund the operating wallet (local genesis), inspect the wallet, watch for faucet funding.
- `npm run contract:compile`: compile the Compact contract (toolchain `0.31.1`).

## Coding Style & Naming Conventions

Use TypeScript ESM, strict compiler settings, two-space indentation, single quotes, and trailing commas where existing code does. Compact sources use four-space indentation. Prefer `camelCase` for values/functions, `PascalCase` for types/components, and kebab-case workspace directories. Keep changes focused; no formatter or linter is currently configured.

**This codebase carries no comments.** Do not add `//`, `/* */`, JSDoc, `--` (SQL), or `<!-- -->` (HTML) comments to source files. Names and structure carry the intent; put anything longer in `docs/`. The only exception is a compiler directive that changes behaviour (`// @ts-ignore`, `// @ts-expect-error`).

## Testing Guidelines

Name tests `*.test.ts`. Shared utilities and CLIs use Node's test runner through `tsx`; the contract test uses Vitest. Add normal and rejection cases for privacy-sensitive changes, especially authorization / role scoping, threshold-band boundaries, `scoreCommitment` mismatch, and the `recordedAt` day window. No coverage threshold is configured; preserve the existing behavioral scenarios.

## Commit & Pull Request Guidelines

Use concise imperative Conventional Commit messages, following the scoped history in this repository, for example `feat(contract): enforce the recordedAt day window`. Pull requests should explain the privacy boundary, list validation commands, link issues, and include screenshots for GUI changes. Call out configuration changes explicitly.

## Security & Configuration Tips

Copy `.env.example` to `.env` (machine-specific overrides in `.env.local`); both are git-ignored. Never commit environment files, wallet mnemonics, the raw condition values, private-state passwords, or the `INGESTER_SALT_HEX`. `.env` is the operating-wallet recovery source and must be backed up securely. The SQL backend is libSQL (a local server or a `file:` SQLite path) via `@midnight-demo/db`; `@midnight-demo/db/d1` wraps a D1 binding for the hosted Worker. The ingester (`apps/ingester`) must not import Compact, wallet, proving, or deployment modules (`boundary.test.ts`).
