# Local development stack

OHAYO! talks to SQL through `@midnight-demo/db`, which speaks libSQL: the
libSQL server in this compose file, or a local SQLite file
(`LIBSQL_URL=file:data/local.db`). Everything runs locally.

## libSQL server (Docker)

```bash
npm run db:up          # docker compose up -d  (libSQL on :8080)
# in .env:  LIBSQL_URL=http://127.0.0.1:8080
npm run db:seed:sample # the sample roster + feed fixtures
                       # (otherwise the operator builds the roster from the
                       #  dashboard's Data admin screen — it has no feed-staging UI)
npm run ingest:plan    # dry-run: read roster + staged feed from the DB, print the plan
npm run ingest:record  # record the plan into the submissions table (no on-chain tx yet)
npm run db:down        # stop + keep the volume  (add `-v` to wipe)
```

Migrations run automatically on first connect (`applyMigrations` against
`packages/db/migrations/*.sql`). `seed/sample-roster.sql` and `seed/sample-feed.sql`
are opt-in `INSERT OR IGNORE` fixtures.

The roster (`rings` / `workers` / `ring_worker_map`) and the
incoming condition feed (`condition_readings`) live in the DB. Login needs no
seeding: the token is the worker's id, with `admin` fixed.

## No Docker (zero config)

With no `LIBSQL_URL`, the ingester uses a local SQLite file
(`data/ingester-local.db`) automatically:

```bash
# .env — the only required value for a local ingester run:
INGESTER_SALT_HEX=...

npm run db:seed:sample && npm run ingest:record
```

No docker, no API. To pin the file path explicitly: `LIBSQL_URL=file:/abs/path.db`.

## Local Midnight devnet (`midnight-compose.yml`)

Separate compose file — the on-chain deploy / submit / read loop without a
public faucet. Node (`midnight-node` 1.0.0), indexer
(`indexer-standalone` 4.3.3), and proof server (`proof-server` 8.1.0), adapted
from `midnightntwrk/midnight-local-dev`.

```bash
npm run midnight:up          # node :9944, indexer :8088, proof-server :6300 (127.0.0.1 only)
# in .env:
#   MIDNIGHT_NETWORK=local
#   MIDNIGHT_PROOF_SERVER_URL=http://127.0.0.1:6300

npm run condition:deploy    # compile + deploy condition-registry -> prints the address
#   put CONDITION_REGISTRY_CONTRACT_ADDRESS in .env
npm run condition:fund        # fund the operating wallet from MIDNIGHT_GENESIS_SEED (default 0x00..01)
npm run db:seed:sample        # or build the roster from the dashboard Data admin screen
npm run ingest:submit         # submit tx per ring, then reconcile the local copy against the chain
npm run condition:reconcile   # periodic: re-confirm any still-unverified submissions rows
npm run condition:status      # submissionCount / lastSubmittedBand from the chain

npm run gateway:serve                           # read API (serves the chain-confirmed submissions local copy)
npm run midnight:down
```

On a machine without Node, the whole loop above runs in Docker as one lane:
`bash ./run.sh e2e` (devnet → fund → deploy →
submit → reconcile → status → dashboard on :8787). `run.sh devnet` brings up just
the devnet.
