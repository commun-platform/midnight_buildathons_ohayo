---
name: sadako-demo
description: Run and present SADAKO — the worksite worker-condition system on Midnight. Use to demo the app (bring up the local devnet, deploy the contract, walk the two roles, show on-chain verification and the tamper-detection story), or to verify the repo (tests / typecheck / Compact contract + ZK-circuit tests). The host has no Node; everything runs in a throwaway Docker container via ./run.sh (run.ps1 / run.bat on Windows).
---

SADAKO records a partner-computed **0–100 worker condition value** on the Midnight
`condition-registry` contract. The raw value stays private (committed as a ZK
witness); only the three-state band `正常` / `要注意` / `危険` is disclosed
on-chain, keyed by a salted hash of the ring id and the day. A role-scoped read
API serves the band history back. One worksite, two roles, and the login token
is simply the worker's id.

Design: [`docs/worksite_condition_system.md`](../../../docs/worksite_condition_system.md)
([日本語](../../../docs/ja/worksite_condition_system.md)).

Everything runs locally — libSQL/SQLite plus a local Midnight devnet. There is no
cloud deployment target, and the dashboard **always** runs against a real deployed
contract — there is no offline/sample-data mode. **The host has no Node/npm**:
every command goes through `./run.sh`, which does the work inside a throwaway
`node:22-bookworm` container with the repo bind-mounted. `run.ps1` is a native
Windows port (Docker Desktop only, no Git Bash / WSL) and `run.bat` is its cmd.exe
shim.

---

# What to do when this skill is invoked

Pick the mode from the user's argument. **With no argument, run the demo.**

| Argument | Do this |
|---|---|
| *(none)* / `demo` / `dashboard` / `chain` / `e2e` / `onchain` | **Demo** — brings up the devnet, deploys the contract, and serves the dashboard. Go to *Demo* below. |
| `test` / `verify` | Run `bash ./run.sh test`, report pass/fail. Add `test_contract` if the contract or band logic changed. |
| `test_all` | `bash ./run.sh test_all` — the three verification lanes in sequence. |
| `stop` / `down` | `bash ./run.sh down`. `clean` also drops the Docker volumes. |

Always run the lane yourself and report what actually happened — never describe a
demo you did not run.

---

## Demo

```bash
bash ./run.sh e2e
```

Brings up a real local devnet (`midnight-node` 1.0.0, `indexer-standalone` 4.3.3,
`proof-server` 8.1.0), funds an operating wallet from the genesis seed, compiles
and deploys `condition-registry`, then serves the dashboard joined to that chain
at <http://localhost:8787>. **Deploy proof generation takes 3–5 minutes** on the
first run — say so before starting, and do something useful with the wait (walk
the contract source, or the privacy matrix in the design doc).

`e2e` is the single entry point — there is no standalone `dashboard` lane.
`RESUME=1 bash ./run.sh e2e` skips fund/deploy and reuses the existing devnet
deployment; use it to restart just the dashboard container (e.g. after a code
change) without redeploying the contract, as long as
`.state/midnight-chain/deployment-local.json` still points at a contract that
exists on the running chain.

The roster and the feed start **empty**. As `admin`, build the roster in データ管理;
scores come from the worker (ring sync) or from the partner mock's simulate command —
the admin never enters a score:

1. リング — create a ring with any name.
2. 作業員 — create `worker-1` (use that exact id so the `worker-1` login works),
   then assign the ring to them from the リング row's 作業員 dropdown.
3. Log in as `worker-1` and send a score from the **リング同期** card. For past days
   or other rings, seed the partner mock (`mn-condition-partner` on :8788) instead:
   `docker exec mn-condition-partner npx tsx apps/partner-mock/src/cli.ts simulate --rings <ring-id> [--date YYYY-MM-DD]`.
4. 送信キュー — press **パートナーから取得**. The toast counts new / duplicate /
   conflict / bad-signature / unknown-ring scores; the rows appear as a **band only**
   (the admin never receives a partner value). Press **チェーンへ送信** — each row
   is proven and submitted as a real transaction and turns 記録済み.

### The two roles — show them in this order

Tokens are trivial: **`worker-1` is the worker's own id**, and `admin` is the one
fixed staff token. No user table, no passwords.

**1. `worker-1` — ユーザー (worker).** The point of the whole system.

- Their own day's band, and **the raw 0–100 number next to it**.
- The **リング同期** card: enter a score (0–100); **パートナーへ送信** posts it straight
  from the browser to the partner mock (not through SADAKO). It reaches SADAKO only when the admin presses パートナーから取得, and the
  chain after チェーンへ送信. One entry per ring per day — a second send for a day
  already on chain shows as スキップ · この日は記録済み. Open the dashboard as
  `http://localhost:8787` (the partner's CORS allows only that origin).
- Nav has one item. A worker sees nothing but themselves.
- Say: *this number is the only place the raw value is ever shown.*

**2. `admin` — 管理者.** Every worker, plus the roster.

- 本日 shows a card per worker on the site.
- Open 一覧: bands, entryKey and tx columns, CSV export — but **no raw values,
  not even for the admin**.
- データ管理 is the roster CRUD plus the submission queue (pull, submit, tamper option), admin-only. The admin cannot enter a score.
- On a 要注意 / 危険 day the card shows **判断未記入**: click it to record the work
  decision (就業 / 軽作業 / 休養). 就業 or 軽作業 on such a day is refused without a
  reason. A correction appends a new row that supersedes the old one — nothing is
  overwritten, and the worker sees the current decision and reason on their screen.
  Decisions are DB-only (not on chain), which is stated in the dialog.
- Say: *the admin runs the site and still cannot see anyone's score.*

That contrast is the demo: **the person the data is about is the only one who can
read it, and the chain still proves the band is honest.**

### Then show the privacy shape

Open `packages/db/migrations/0001_condition_schema.sql` and
`contracts/condition-registry/src/condition-registry.compact` side by side, or
just talk over the 一覧 table:

- `entryKey` is `sha256(ringId ‖ periodStartMs ‖ salt)` — keyed by **ring**, not
  by person, and salted. Without the salt you cannot tell which entries belong to
  the same worker.
- `scoreCommitment` is on chain; the score is not.
- The salt never reaches the browser, so the client cannot compute an entryKey it
  was not given.

### The money shot: tamper detection

In データ管理's 送信キュー, next to **チェーンへ送信**, is a **ローカル記録を改ざんする**
checkbox. With it ticked, the worker's value stays in the local database while the
chain receives a value from a *different* band.

1. Have the worker send a score for a day that ring has not submitted yet (the
   contract rejects a duplicate `(ring, day)`), pull it, tick the box and press
   チェーンへ送信. The toast says the local record now disagrees with the chain.
2. Go to 一覧 and press **照合** on that row.
3. **Press 照合 a second time.** This is not optional — see below.
4. The second press reports a mismatch, **corrects the local row from the chain**
   (`正常` → `危険` in the seeded example), and withdraws the verification.

> **照合 is two-phase — the first press does not touch the chain.**
> `reconcileSubmissions` runs with `phased: true`. For a row whose `reconciled_at`
> is still NULL it just stamps `chain_verified_at` / `reconciled_at` from the
> stored record and returns `localChecked: 1`; only once `reconciled_at` is set
> does the next call open an `indexerConditionReader` and query the chain. So a
> single press on a fresh row looks like "nothing happened" — the toast says
> 「ローカル記録で照合済み（もう一度押すとチェーンに直接照会）」. Press again.
> Expect `{ mismatches: 1, valueMismatches: 1 }` on the second press.

Say: *the operator's own database was altered and the chain caught it. That is the
property a signed database cannot give you — the company that signed it is the
company under investigation.*

---

## Verification lanes

```bash
bash ./run.sh test           # 90 unit tests + typecheck, SDK-free — the fast gate
bash ./run.sh test_sdk       # typecheck + tests for the Midnight-SDK workspaces
bash ./run.sh test_contract  # compile with Compact 0.31.1 + 15 ZK-circuit tests
bash ./run.sh test_all       # the three above, stops on first failure
bash ./run.sh db             # ingester end-to-end vs a real libSQL server container
```

| Lane | What it does |
|---|---|
| `test` | `npm run test` + `tsc --noEmit` for `@midnight-demo/{shared,db,condition-read,ingester-core,ingester,gateway,partner-mock}` |
| `test_sdk` | `tsc --noEmit` + static tests for `@midnight-demo/{midnight-chain,condition-cli}`. Pulls the full Midnight SDK into `mn-condition-sdk-node-modules` (minutes on first run). No proof server / wallet / chain. |
| `test_contract` | `compactc` 0.31.1 (fixed release, sha256-verified, cached in `mn-compact-toolchain`) compiles `condition-registry.compact` → `src/managed/`, then vitest + typecheck. Covers all three bands, the boundaries (60/59/40/39), duplicate-`entryKey` rejection, commitment mismatch (tampered value and tampered nonce), and the `recordedAt` day window. No proof generation, no chain. |
| `db` | ingester vs a real `ghcr.io/tursodatabase/libsql-server` container on a private network: `seed --sample` → `record --local` → `plan` (expects 2 already-submitted) |
| `devnet` | just the compose stack, no app work |
| `deploy_preprod [wallet\|funding\|deploy\|status]` | deploy `condition-registry` to Midnight **preprod** with the wallet in `.env.preprod` (not `.env`); starts its own proof server. A new wallet's first `deploy` takes ~70 min (DUST wallet sync). Runbook: `docs/deploy_preprod.md`. Needs the user to request tNIGHT from the faucet (CAPTCHA) |
| `down` / `clean` | stop containers / also delete the `mn-condition-*` volumes |

There is no standalone `dashboard` lane — `e2e` deploys and serves it in one
step; `RESUME=1 bash ./run.sh e2e` restarts just the dashboard against an
already-deployed contract.

`test` is the gate after any change. Add `test_contract` whenever the `.compact`
source, `packages/shared`'s commitment/band logic, or the circuit tests move.

Deprecated aliases: `sdk`→`test_sdk`, `contract`→`test_contract`, `integrate`→`e2e`,
`dashboard`→`e2e` (with `RESUME` defaulted to `1`), `--down`→`down`, `--clean`→`clean`.

---

## Repository conventions

Read these before editing anything here.

- **No comments.** This codebase carries none — no `//`, `/* */`, JSDoc, SQL `--`
  or HTML `<!-- -->`. Names and structure carry the intent; longer explanation
  goes in `docs/`. The only exception is a compiler directive that changes
  behaviour (`// @ts-ignore`, `// @ts-expect-error`). Do not reintroduce comments.
- **Two roles, no scope machinery.** `admin` (管理者 — every worker, plus the
  Data admin screen), `worker` (ユーザー — themselves, and the only role that
  sees the raw 0–100 value).
- **Auth is the token.** `admin` is a fixed string in `apps/gateway/src/auth.ts`;
  any other token is looked up as a `workers.id`. There is no users table and no
  `role_assignments`.
- **There is no site.** One worksite is assumed. The day boundary comes from
  `APP_TIME_ZONE` in `packages/shared/src/period.ts`.
- **The dashboard always runs on-chain.** There is no offline/sample-data mode
  and no standalone `dashboard` lane — `run.sh e2e` is the one command that
  deploys the contract and serves the dashboard joined to it.
- **libSQL locally, D1 adapter ready.** `createDatabase({ url })` takes a libSQL
  URL (`file:` or `http://`). `@midnight-demo/db/d1` (`d1Database(binding)`) wraps
  a Cloudflare D1 binding for the hosted Worker; nothing is hosted until phase 6
  of `docs/next_phase_design.md`. No `STORAGE_MODE`.
- **The ingester stays SDK-free.** `apps/ingester` and `apps/gateway` must not
  import Compact, wallet, proving or deployment modules —
  `apps/ingester/src/boundary.test.ts` enforces it. Only `packages/midnight-chain`
  touches the Midnight SDK, and it never touches the database: it exposes the
  `ConditionChain` port (`conditionChain(network, address)`), and the DB side of
  submit / reconcile lives in `apps/ingester/src/{store,submit,reconcile}.ts`.
  `apps/gateway/src/boundary.test.ts` walks the Worker-facing import graph and
  fails if it reaches the Compact runtime (`@midnight-demo/shared/commitment`),
  the SDK, libSQL, or a Node built-in.
- **Licensing.** Apache-2.0 (`LICENSE`, `NOTICE`, and a `license` field in every
  `package.json`). Keep new workspaces consistent — the Buildathon rules require it.
- Schema changes go straight into the single migration
  `packages/db/migrations/0001_condition_schema.sql`; there is no history to preserve.

---

## Setup and prerequisites

- **Docker** only (Docker Desktop on Windows, daemon running). `docker version`
  must show a Server section.
- The `node:22-bookworm` image — `docker pull node:22-bookworm` if missing.
- Never run `node` / `npm` / `npx` on the host; they do not exist here.
- No manual install step. `run.sh` runs a scoped `npm ci` into a Docker volume on
  first use (marker: `node_modules/tsx` for `test`,
  `node_modules/@midnight-ntwrk/wallet-sdk` for `test_sdk`). After a dependency
  change: `bash ./run.sh clean`, then re-run.
- Lanes can also come from `MODE_ENV` in the shell or in `.env` / `.env.local`
  (a positional argument wins; a shell value beats the file). `RESUME` is read
  the same way.
- **Windows**: from cmd.exe / PowerShell use `run.bat <lane>` or `.\run.ps1 <lane>`.
  Container-side scripts are passed as base64 so PowerShell arg-quoting cannot
  corrupt them; env vars pass through the process environment.

## Gotchas

- **`.env` is optional for `test` / `db`** — those inject a development
  `INGESTER_SALT_HEX`. `e2e` needs `.env` to exist (see below).
- **Do not pass Japanese text through `curl -d` from Git Bash.** MSYS mangles the
  UTF-8 in the argument, and the API stores the broken bytes (`作業員 一郎` lands
  as `??ƈ? ??Y`). Write the JSON to a file as UTF-8 and send it with
  `--data-binary @file.json`, or drive the form in the browser. Only affects
  scripted setup; normal UI use is unaffected.
- **`e2e` needs `.env` to exist** — `run.sh` only checks the file is present
  (`cp .env.example .env`, no edits needed) and passes its own
  `MIDNIGHT_NETWORK=local` / `MIDNIGHT_GENESIS_SEED` /
  `DEVELOPMENT_PRIVATE_STATE_PASSWORD` defaults into the container, then writes
  the generated operating-wallet mnemonic back into `.env`. `.env` is git-ignored
  and the devnet wallet is throwaway. (Running the individual `npm run
  condition:*` scripts directly on a Node host, outside `run.sh`, does read
  `.env` for real — set `MIDNIGHT_NETWORK=local` there first.)
- **`down` stops the devnet too.** To restart just the dashboard while keeping
  the chain and its deployed contract up: `RESUME=1 bash ./run.sh e2e`.
- **The genesis allocation is spent once per devnet.** If `fund` fails with
  "Genesis wallet holds ... need ...", the chain has already been funded once —
  recreate it with `run.sh down` then `run.sh e2e`.
- **Don't put node_modules on the bind mount** — Docker Desktop for Windows breaks
  `npm ci` there (`ENOTEMPTY`). `run.sh` uses named volumes.
- **`e2e` writes its libSQL to a volume**, not a `file://` on the bind mount
  (that hits `SQLITE_CANTOPEN 14` on Windows). `clean` removes it.
- Windows path handling: under Git Bash / MSYS, `run.sh` uses `MSYS_NO_PATHCONV=1`
  plus `cygpath -w "$PWD"`.
- `compactc` is a musl static binary and runs on `node:22-bookworm` as-is. On an
  arm64 host, swap the URL and sha256 in `run.sh` for the aarch64 build.

## Troubleshooting

- **`node: command not found` / `npm: not recognized`** — you ran a bare
  `node`/`npm`. Go through `run.sh`.
- **`tsc: not found` / `tsx: not found` / `vitest: not found`** — a volume install
  was interrupted. `bash ./run.sh clean`, then re-run.
- **`Cannot connect to the Docker daemon`** — Docker Desktop is not running.
- **`ENOTEMPTY` / `docker: invalid reference format` / `working directory ... is invalid`**
  — MSYS path rewriting or node_modules on the bind mount; `run.sh` avoids both.
- **`dashboard needs the devnet` / `no deployed contract`** — an internal guard
  inside `e2e`'s last step; should not fire in normal use. If it does, the
  devnet health check likely failed earlier in the same run — check
  `docker ps` / `docker logs midnight-node` and re-run `bash ./run.sh e2e`.
- **Dashboard shows an empty page** — hard-reload; the SPA is cached by the
  browser and `app.js` changed.
