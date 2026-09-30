# Deploying condition-registry to Midnight preprod

> [日本語版](ja/deploy_preprod.md)

This runbook deploys the `condition-registry` contract to **Midnight preprod** from a
development host that has only Docker. Every step goes through `run.sh deploy_preprod`
(`.\run.ps1 deploy_preprod` on Windows without Git Bash), which runs the
`condition-cli` inside a throwaway `node:22-bookworm` container next to a local
proof server. The design behind it is [`next_phase_design.md`](next_phase_design.md) §7.

Proving happens on this host (the local proof server); preprod only receives the
proven transactions. Nothing here touches Cloudflare — the hand-off to the hosted
chain runner is the last section.

## Current deployment

| | |
|---|---|
| Network | Midnight preprod |
| Contract address | `1fca6b4cec100a425db72d769d1ef19f673de7552b4c9196611797f6b565e7ed` |
| Operating wallet | `mn_addr_preprod1xcr2lqjjvh5c2twxtzjref5rmkt4haaclxprkxfdywvhu00c5ljsl09553` |
| DUST registration tx | `00e7c5f28875253a0f2034846ad9e1a4beb356e9e6df16c201213d03a740192563` |
| Deployed at | 2026-09-29T18:50:45Z |

The same values are in `.state/midnight-chain/deployment-preprod.json` and
`.env.preprod` on the deploying host.

## What the lane does

```
bash ./run.sh deploy_preprod [wallet | funding | deploy | status]
```

| Step | Does | Needs |
|---|---|---|
| `wallet` | creates the operating wallet on first use, syncs it, prints the address and balances | `.env.preprod` |
| `funding` | waits until tNIGHT arrives at the wallet | the faucet request |
| `deploy` | compiles the contract if needed, syncs the DUST wallet, registers NIGHT for DUST generation, waits for spendable DUST, proves and deploys, then runs `status` | tNIGHT |
| `status` | reads the contract ledger from the preprod indexer | a deployment |
| *(none)* | `funding` → `deploy` → `status` | |

Every step:

- starts `mn-condition-preprod-proof` (`midnightntwrk/proof-server:8.1.0`) on the
  `mn-condition-preprod-net` network if it is not running, and leaves it running;
- reads **`.env.preprod`**, not `.env` (`DEVELOPMENT_ENV_FILE=.env.preprod`), so the
  preprod wallet never mixes with the devnet wallet that `run.sh e2e` writes into `.env`;
- forces `MIDNIGHT_NETWORK=preprod` and the proof server URL, whatever the file says;
- replaces the recovery phrase in its output with a pointer to `.env.preprod`.

Wallet sync state is saved under `.state/midnight-chain/wallet-sync/preprod/` every
minute and on exit, so an interrupted step resumes where it stopped.

## 1. Create `.env.preprod`

`.env.preprod` is git-ignored (`.env.*`). Generate the salt and the private-state
password with Docker so no Node is needed on the host:

```bash
docker run --rm node:22-bookworm node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"
```

```bash
docker run --rm node:22-bookworm node -e "console.log(require('crypto').randomBytes(24).toString('base64'))"
```

```
MIDNIGHT_NETWORK=preprod
CONDITION_REGISTRY_CONTRACT_ADDRESS=
DEVELOPMENT_WALLET_MNEMONIC=
DEVELOPMENT_WALLET_SEED=
DEVELOPMENT_PRIVATE_STATE_PASSWORD=<the base64 value>
INGESTER_SALT_HEX=<the hex value>
MIDNIGHT_SYNC_TIMEOUT_MS=3600000
MIDNIGHT_DUST_TIMEOUT_MS=43200000
MIDNIGHT_DUST_BATCH_SIZE=100
PUBLIC_MIDNIGHT_NETWORK=Midnight Preprod
```

- Leave both wallet fields empty: the first step generates a 24-word mnemonic and
  writes it into this file.
- `INGESTER_SALT_HEX` is fixed for the life of the registry. Changing it changes every
  entryKey.
- **Back this file up** (a password manager, not the repository or a chat). The
  mnemonic is the only way to recover the wallet and its tNIGHT.

## 2. Create the wallet

```bash
bash ./run.sh deploy_preprod wallet
```

```
New operating wallet recovery phrase:
  (written to .env.preprod - back that file up)
Wallet: mn_addr_preprod1...
raw tNIGHT: 0  raw DUST: 0
PREPROD OK
```

The step took about a minute on 2026-09-30.

## 3. Request tNIGHT from the faucet

Open <https://midnight-tmnight-preprod.nethermind.dev>, paste the `mn_addr_preprod1…`
address and request tNIGHT. The faucet has a CAPTCHA, so this step is manual.

## 4. Wait for the funds

```bash
bash ./run.sh deploy_preprod funding
```

It prints `Watching for tNIGHT...` and exits with `tNIGHT received: raw 5000000000`
once the faucet transfer lands (about a minute on 2026-09-30). You can start it
before requesting from the faucet.

## 5. Deploy

```bash
bash ./run.sh deploy_preprod deploy
```

This is the long step. Measured on 2026-09-30 with a brand-new wallet: about 70
minutes in total, of which about 65 were the DUST wallet sync.

1. **DUST wallet sync.** A new wallet replays every DUST event on preprod
   (about 1.57 million at the time). Progress is printed every 30 seconds, e.g.
   `DUST wallet sync: 812345 of 1575226 (51%)`. The wait is bounded by
   `MIDNIGHT_DUST_TIMEOUT_MS` (12 hours), not the one-hour
   `MIDNIGHT_SYNC_TIMEOUT_MS`.
2. **Registration.** `Waiting for 1 NIGHT UTXO(s) to generate the ~… DUST
   registration fee...`, then `DUST registration submitted: <tx id>`.
3. **Spendable DUST.** `Waiting for spendable DUST (>= 5000000000000000)...` →
   `Spendable DUST is available.` A few minutes.
4. **Proof and deploy.** A few minutes of proving on the local proof server, then
   `conditionRegistry deployed: <address>`.
5. **Status.** The ledger is printed with `submissionCount: "0"`.

Then put the address into `.env.preprod`:

```
CONDITION_REGISTRY_CONTRACT_ADDRESS=<address>
```

`status` and later submissions also find it through
`.state/midnight-chain/deployment-preprod.json`, but the Cloudflare hand-off reads it
from the file.

## 6. Check

```bash
bash ./run.sh deploy_preprod status
```

## Messages that look alarming but are not

| Output | Meaning |
|---|---|
| `Wallet.Sync: [object Object]` with a stack trace, once, early in `deploy` | a shielded-wallet indexer subscription error inside the wallet SDK. On 2026-09-30 the run continued and deployed normally |
| `RPC-CORE: submitAndWatchExtrinsic ... disconnected ... 1000:: Normal Closure` right after `deployed` | the submission socket closing after the transaction was accepted |
| `proof server URL uses unencrypted http:// for non-loopback host` | the proof server is reached over the private Docker network |
| no new line for minutes before the DUST progress lines appear | the SDK is catching the wallet up; the container stays at ~100% CPU |

## Stopping and cleaning up

- `bash ./run.sh down` removes the preprod proof server and network — **and** stops
  the local devnet if it is running.
- Keep `.state/midnight-chain/wallet-sync/preprod/`: deleting it makes the next step
  replay the whole DUST history again.

## Handing the wallet to Cloudflare (phase 6)

Not available yet — the Worker and its containers are phase 6 of
[`next_phase_design.md`](next_phase_design.md) §11. When they exist:

1. Put each secret into the Worker with `wrangler secret put`, reading from standard
   input so nothing is echoed: the seed as `OPERATING_WALLET_SEED`, `INGESTER_SALT_HEX`,
   and `DEVELOPMENT_PRIVATE_STATE_PASSWORD`. The contract address goes into the Worker
   vars.
2. **From then on only the container uses this wallet.** The submitter key is derived
   from the seed (`submitterSecretKeyHex` in `packages/midnight-chain/src/state.ts`),
   and two hosts spending the same DUST collide. Do not run `deploy_preprod deploy`
   (or any submission) from the development host after the hand-off.

## Replacing the contract

A new deployment is a new registry with an empty ledger. Existing `submissions` rows
keep their original `deployment_id`, and the salt stays the same. Run
`deploy_preprod deploy` again with the same `.env.preprod`; the wallet is already
synced and registered, so it only waits for DUST and proves.
