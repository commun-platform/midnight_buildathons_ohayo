# Hosting on Cloudflare (workers.dev)

> Runbook for next-phase design §8 (phase 6). It puts OHAYO! on
> `https://midnight-proof-ohayo.<your-subdomain>.workers.dev` so the demo works with the development
> host switched off. Run it after the preprod deployment in
> [`deploy_preprod.md`](deploy_preprod.md): it reuses that wallet, salt and contract.
>
> [日本語版](ja/deploy_cloudflare.md)

## What gets created

Everything below is declared in one [Alchemy](https://alchemy.run) stack,
`apps/worker/alchemy.run.ts`. `deploy` creates or updates it to match the file, and
`destroy` removes all of it.

| Resource | Name | Role |
|---|---|---|
| Worker | `midnight-proof-ohayo` | the dashboard (static assets), `/api/*` (the same `handleApi` as the local gateway), the minute Cron that drains the submission queue |
| D1 | `ohayo` | roster, readings, submissions, decisions, wallet bindings, guests, `chain_jobs`; `packages/db/migrations` is applied on deploy |
| Container | `ChainRunnerContainer` (`apps/chain-runner/Dockerfile`, built on deploy) | the operating wallet: plan, prove and submit `condition-registry` transactions; read entries back for verify |
| Container | `ProofServerContainer` (`midnightntwrk/proof-server:8.1.0`) | proofs, reached only by the chain runner through `proof.internal` |
| R2 | `ohayo-wallet-state` | the encrypted wallet sync checkpoint (`ohayo-wallet/preprod/checkpoint.enc` and the previous copy) |
| Worker + D1 | `midnight-proof-ohayo-partner` + D1 `ohayo-partner` | the partner mock, reached by browsers directly and by `midnight-proof-ohayo` through a service binding; `apps/partner-mock/migrations` is applied on deploy |

## Cost

Cloudflare Containers need the **Workers Paid plan (US$5 / month)**. Everything else
here fits that plan's included usage at demo volume.

The containers are billed only while they run, so OHAYO! starts them **on demand**:

- The Cron wakes the chain runner only when the queue holds a reading (or a job is in
  flight). An idle demo never starts a container.
- The chain runner stops 5 minutes after its last request, the proof server 3 minutes
  after its last proof.
- Verify (`POST /api/reconcile`) starts the chain runner for a read, which needs no
  synced wallet.

The chain runner is a custom 1 vCPU / 3 GiB instance (it uses about 600 MB but is
CPU-bound while the wallet syncs) and the proof server is `standard-1` (1/2 vCPU, 4 GiB),
each with at most one instance. Memory is billed on the provisioned size: one submission
round (boot, restore, catch-up sync, proof, submit, 5 minutes idle) costs roughly
1–2 GiB-hours for the pair, and the plan includes 25
GiB-hours a month, so a judging period with dozens of submissions stays at US$5. Preprod
fees are DUST from faucet tNIGHT — no money.

The price of on-demand is a slow first submission: the chain runner boots, restores the
wallet checkpoint and catches up the blocks since it last ran, and the proof server
downloads its proving parameters from `srs.midnight.network`. Expect several minutes
before the first transaction of a session; later ones within the idle window are fast.
The screen shows the stage while it waits.

`./run.sh cloudflare destroy` stops all of it (see [Removing everything](#removing-everything)).

## Before you start

1. **Preprod deployment done** ([`deploy_preprod.md`](deploy_preprod.md)): `.env.preprod`
   holds the operating wallet mnemonic, `DEVELOPMENT_PRIVATE_STATE_PASSWORD`,
   `INGESTER_SALT_HEX` and `CONDITION_REGISTRY_CONTRACT_ADDRESS`, and
   `.state/midnight-chain/wallet-sync/preprod/` holds a synced wallet. The compiled contract
   in `contracts/condition-registry/src/managed/` must be the one you deployed — the
   container image copies it.
2. **A Cloudflare account on Workers Paid.** In the dashboard, open **Workers & Pages**
   once so the account gets its `workers.dev` subdomain; note the subdomain
   (`<subdomain>.workers.dev`).
3. **An account API token.** **My Profile → API Tokens → Create Token**, start from the
   **Edit Cloudflare Workers** template and add **Account · D1 · Edit** and
   **Account · Containers · Edit**. Restrict it to your account. If a later step fails
   with an authorization error, add the permission it names and retry.
4. **The admin wallet key hash** for `ADMIN_WALLET_KEY_HASHES` in `.env.cloudflare` — the
   same value as in `.env` if the same Lace wallet is the admin. The hosted deployment
   never reads `.env`, so changing the local admin does not change the hosted one.
5. **Docker Desktop running.** Alchemy builds the chain-runner image through the host
   Docker; nothing else is installed on the host.

Create `.env.cloudflare` in the repository root (git-ignored by `.env.*`):

```
CLOUDFLARE_API_TOKEN=<the token>
CLOUDFLARE_ACCOUNT_ID=<Workers & Pages → Account details → Account ID>
WORKERS_SUBDOMAIN=<the part before .workers.dev>
ADMIN_WALLET_KEY_HASHES=<key hash; several separated by commas>
```

## Steps

Every step runs in Docker (`run.sh` from Git Bash or WSL, `run.ps1` from PowerShell —
the same step names). The stack runs with stage `demo`.

1. **Check** (no account needed): typechecks the Worker and the stack, runs the Worker
   tests and builds the chain-runner image.

   ```bash
   ./run.sh cloudflare check
   ```

2. **Plan**: shows what `deploy` would create, change or delete; nothing is applied.

   ```bash
   ./run.sh cloudflare plan
   ```

3. **Deploy**: creates or updates everything in the stack — the D1 databases with their
   migrations, the R2 bucket, both Workers with their secrets, and both containers (the
   chain-runner image is built and pushed; the first deploy takes several minutes).

   ```bash
   ./run.sh cloudflare deploy
   ```

   The secrets come from files, never from a command line or the screen:

   | Worker | Secret | Source |
   |---|---|---|
   | `midnight-proof-ohayo` | `OPERATING_WALLET_MNEMONIC` | `DEVELOPMENT_WALLET_MNEMONIC` in `.env.preprod` |
   | `midnight-proof-ohayo` | `DEVELOPMENT_PRIVATE_STATE_PASSWORD`, `INGESTER_SALT_HEX` | `.env.preprod` |
   | `midnight-proof-ohayo` | `SESSION_SECRET` | generated once into `.state/cloudflare/session-secret` |
   | `midnight-proof-ohayo` | `ADMIN_WALLET_KEY_HASHES` | `.env.cloudflare` |
   | `midnight-proof-ohayo` | `PARTNER_API_KEY` (+ `PARTNER_PUBLIC_KEY` as a var) | generated once into `.state/cloudflare/partner.env` |
   | `midnight-proof-ohayo-partner` | `PARTNER_API_KEY`, `PARTNER_SIGNING_KEY` | the same file |

   The lane gathers the generated ones into `.state/cloudflare/secrets.env`. The mnemonic
   reaches only the chain-runner container's process environment; the Worker code never
   reads it.

4. **Checkpoint**: seals the synced preprod wallet state from
   `.state/midnight-chain/wallet-sync/preprod/` with AES-GCM under a key derived from the
   wallet seed and uploads it to R2. Without it the first container sync replays the whole
   history (about an hour on 2026-09-30).

   ```bash
   ./run.sh cloudflare checkpoint
   ```

5. **Status**: prints `/api/config` and the container applications.

   ```bash
   ./run.sh cloudflare status
   ```

`./run.sh cloudflare all` runs deploy, checkpoint and status in order.
`./run.sh cloudflare tail` streams the Worker log (the Cron logs one `chain_queue` line
per action).

**From here only the container uses the operating wallet.** Do not run
`deploy_preprod deploy`, `condition:submit` or a local submission with `.env.preprod`
while the hosted demo runs: two hosts spending the same DUST collide.

**The stack state holds secrets.** Alchemy keeps what it deployed in
`.state/cloudflare/.alchemy/`, including the secret values in plain text. Treat it like
`.env.preprod`: it is git-ignored and kept out of container images, and `destroy` needs it
to know what to delete — do not remove it while the demo is deployed.

## Try it

1. Open `https://midnight-proof-ohayo.<subdomain>.workers.dev`, choose **Try it as a guest**. You start as
   the guest's worker: send a score from the ring sync card (it goes straight to
   `midnight-proof-ohayo-partner`).
2. Switch to the admin persona, open **Data admin → Submission queue**, press
   **Pull from partner**, then **Submit to chain**. The rows become **queued**; the page
   refreshes every 15 seconds and shows the chain runner's stage.
3. Within a minute the Cron starts a job. On a cold start allow several minutes; the row
   turns **recorded** with a transaction, and the band appears in the list.
4. Press verify in the list twice: the first press checks the local record, the second
   reads the entry back from the chain through the chain runner (phase 7 makes it one
   press, §9.8).

Log in with Lace as the admin the same way as locally; the wallet network is preprod.

## Measuring memory (§9.10)

Open **Workers & Pages → Containers** after a submission and pick the chain runner (and
the proof server): the instance metrics show memory and CPU over time. If a job fails with
an out-of-memory exit, raise the runner's `memoryMib` in `apps/worker/alchemy.run.ts` and
deploy again. On 2026-10-03 the runner used about 600 MB with the CPU pinned, which is why
it has a full vCPU. The Worker log records every container stop as `container_stopped`
with the exit code (137 means out of memory).

## Updating

- Code, dashboard or stack change: `./run.sh cloudflare deploy` (Alchemy changes only
  what differs; `plan` shows it first).
- Schema change: add a numbered file in `packages/db/migrations`, then deploy — the stack
  applies new migrations. From the first hosted deployment on,
  `0001_condition_schema.sql` is never edited in place.
- Rotate the session secret: delete `.state/cloudflare/session-secret`, then deploy (every
  session ends). Rotate the partner keys the same way with `.state/cloudflare/partner.env`.

## Removing everything

```bash
./run.sh cloudflare destroy
```

It asks you to type `ohayo`, then deletes both Workers, both D1 databases (all hosted
data), the R2 bucket with the checkpoint, both container applications, and the container
images left in the registry. Local files — `.env.preprod`, the wallet state, the
generated keys — stay, and so does the contract with its entries on Midnight preprod.
Afterwards cancel Workers Paid if nothing else uses it. The operating wallet can be used
from the development host again.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `Cannot connect to the Docker daemon` | Docker Desktop is not running |
| `Authentication error` / `Unauthorized` | the token lacks a permission; add it (Containers · Edit and D1 · Edit are the usual ones) |
| `SchemaError(Expected string at ["..."])` | a secret the stack reads is missing — check `.env.preprod` and `.env.cloudflare` |
| Rows stay **queued**, stage `unreachable` | the chain runner is still booting; `./run.sh cloudflare tail` shows the start. After 90 minutes the job is marked lost and the rows are retried |
| Job **failed**: `Wallet has no tNIGHT` / DUST timeout | fund the operating wallet from the preprod faucet (`deploy_preprod.md` step 3); the next submit retries |
| Stage stays on wallet sync for a long time | the checkpoint was missing or old; the runner stores a fresh one after every job, so only the first run is slow. Do not re-run `./run.sh cloudflare checkpoint` once the hosted runner has submitted — the development host's copy is older than R2's |
| `/api/partner/pull` returns 502 | `midnight-proof-ohayo-partner` is missing or failing; `./run.sh cloudflare plan` shows whether the stack is complete |
