#!/usr/bin/env bash
#
# run.sh - test/verify harness for SADAKO (the worksite condition system).
#
# The host machine has no Node/npm, so everything runs inside a throwaway
# `node:22-bookworm` Docker container with the repo bind-mounted. node_modules
# lives in a Docker VOLUME, never on the Windows bind mount (bind-mounted npm
# installs hit ENOTEMPTY / are unbearably slow).
#
# Usage (from Git Bash / WSL / any bash):
#   ./run.sh <lane>
#   MODE_ENV=<lane> ./run.sh                     # lane from the env
#   (MODE_ENV / RESUME are also read from .env / .env.local when unset)
#
# Lanes:
#   test           unit tests + typecheck (SDK-free workspaces) - fast
#   test_sdk       typecheck + tests for the Midnight-SDK workspaces
#   test_contract  compile condition-registry + run its ZK-circuit tests
#   test_all       test + test_sdk + test_contract
#   db             ingester end-to-end against a docker libSQL server
#   devnet         bring up the local Midnight devnet (node + indexer + proof-server)
#   e2e            ONE COMMAND: devnet -> fund -> deploy -> dashboard on :8787,
#                  joined to the deployed contract
#                  (RESUME=1 skips fund/deploy and reuses the existing deployment
#                  and dashboard - use this to just restart the dashboard)
#   deploy_preprod [wallet|funding|deploy|status]
#                  deploy condition-registry to Midnight preprod with the wallet
#                  in .env.preprod (no step = funding -> deploy -> status)
#   down           stop the dashboard / devnet / local libSQL containers
#   clean          also delete the node_modules + toolchain volumes
#
# Aliases (deprecated): sdk->test_sdk, contract->test_contract, integrate->e2e,
#                       dashboard->e2e, --down->down, --clean->clean
#
set -euo pipefail

VOLUME=mn-condition-node-modules
CONTRACT_VOLUME=mn-condition-contract-node-modules
SDK_VOLUME=mn-condition-sdk-node-modules
TOOLCHAIN_VOLUME=mn-compact-toolchain
# The `e2e` run writes its libSQL file here; the dashboard reads the same volume.
# A named volume, not the Windows bind mount (libSQL file:// there is flaky).
E2E_DB_VOLUME=mn-condition-e2e-data
IMAGE=node:22-bookworm
PREPROD_ENV_FILE=.env.preprod
PREPROD_NET=mn-condition-preprod-net
PREPROD_PROOF=mn-condition-preprod-proof
PROOF_SERVER_IMAGE=midnightntwrk/proof-server:8.1.0
PARTNER_DATA_VOLUME=mn-condition-partner-data
PARTNER_ENV_FILE=.state/partner-mock/dev.env

# Compact toolchain 0.31.1 (language 0.23.0) - the version pinned in .compact-version.
# A versioned release artifact (not `curl | sh`); the sha256 is checked before use.
COMPACTC_URL='https://github.com/midnightntwrk/compact/releases/download/compactc-v0.31.1/compactc_v0.31.1_x86_64-unknown-linux-musl.zip'
COMPACTC_SHA256='e291b4bab4d4e857707008f8b1c25c2b8e0c843f6c737d0ee6c0d9ac69a6bbfb'

# repo root = the directory holding this script
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

# The harness lane controls (MODE_ENV / RESUME) may also be pinned in
# .env / .env.local so a checkout has a default lane without re-exporting each
# shell. A real shell env var always wins; .env.local wins over .env; the
# positional arg still wins over MODE_ENV.
load_harness_env() {
  local file line key val
  for file in "$ROOT/.env.local" "$ROOT/.env"; do
    [ -f "$file" ] || continue
    while IFS= read -r line || [ -n "$line" ]; do
      line="${line%$'\r'}"
      line="${line#"${line%%[![:space:]]*}"}"          # ltrim
      case "$line" in ''|'#'*) continue ;; esac
      line="${line#export }"
      key="${line%%=*}"
      [ "$key" = "$line" ] && continue                  # no '='
      key="${key%"${key##*[![:space:]]}"}"              # rtrim key
      case "$key" in MODE_ENV|RESUME) ;; *) continue ;; esac
      [ -n "${!key:-}" ] && continue                    # already set in the shell / earlier file
      val="${line#*=}"
      val="${val%%#*}"                                  # strip inline comment
      val="${val#"${val%%[![:space:]]*}"}"; val="${val%"${val##*[![:space:]]}"}"  # trim
      val="${val#\"}"; val="${val%\"}"; val="${val#\'}"; val="${val%\'}"
      if [ -n "$val" ]; then export "$key=$val"; fi
    done < "$file"
  done
}
load_harness_env

# Windows Docker needs a Windows-form path for -v; Git Bash provides cygpath.
HOSTPATH=$ROOT
if command -v cygpath >/dev/null 2>&1; then
  HOSTPATH=$(cygpath -w "$ROOT")
fi

MOUNTS=(
  -v "${HOSTPATH}:/app"
  -v "${VOLUME}:/app/node_modules"
  -v /app/packages/shared/node_modules
  -v /app/packages/db/node_modules
  -v /app/packages/ingester-core/node_modules
  -v /app/packages/condition-read/node_modules
  -v /app/apps/ingester/node_modules
  -v /app/apps/gateway/node_modules
  -v /app/apps/partner-mock/node_modules
)

OFFLINE_WS='@midnight-demo/shared @midnight-demo/db @midnight-demo/condition-read @midnight-demo/ingester-core @midnight-demo/ingester @midnight-demo/gateway @midnight-demo/partner-mock'

# Scoped install: only the workspaces the offline flow needs. tsx hoists to the
# root node_modules, so its presence is the "already installed" marker.
INSTALL='[ -d node_modules/tsx ] || npm ci \
  --workspace @midnight-demo/shared \
  --workspace @midnight-demo/db \
  --workspace @midnight-demo/condition-read \
  --workspace @midnight-demo/ingester-core \
  --workspace @midnight-demo/ingester \
  --workspace @midnight-demo/gateway --workspace @midnight-demo/partner-mock \
  --include-workspace-root=true --no-audit --no-fund'

# ---------------------------------------------------------------------------
# lanes
# ---------------------------------------------------------------------------
lane_down() {
  docker rm -f mn-condition-libsql mn-condition-dashboard mn-condition-partner mn-condition-integrate mn-condition-preprod "$PREPROD_PROOF" >/dev/null 2>&1 || true
  docker network rm mn-condition-net "$PREPROD_NET" >/dev/null 2>&1 || true
  docker compose -f "$ROOT/ops/local/midnight-compose.yml" down >/dev/null 2>&1 || true
  echo "removed containers"
  if [ "${1:-}" = clean ]; then
    docker volume rm "$VOLUME" "$CONTRACT_VOLUME" "$SDK_VOLUME" "$TOOLCHAIN_VOLUME" "$E2E_DB_VOLUME" "$PARTNER_DATA_VOLUME" >/dev/null 2>&1 || true
    echo "removed volumes (next run reinstalls)"
  fi
}

partner_dev_env() {
  local file="$ROOT/$PARTNER_ENV_FILE"
  [ -s "$file" ] && return 0
  mkdir -p "$(dirname "$file")"
  MSYS_NO_PATHCONV=1 docker run --rm -w /app \
    -v "${HOSTPATH}:/app" \
    -v "${SDK_VOLUME}:/app/node_modules" \
    -v /app/packages/shared/node_modules \
    -v /app/apps/partner-mock/node_modules \
    "$IMAGE" npx --no-install tsx apps/partner-mock/src/cli.ts keygen > "$file.tmp"
  mv "$file.tmp" "$file"
  echo "generated partner mock dev keys ($PARTNER_ENV_FILE)"
}

partner_env_value() {
  grep -E "^$1=" "$ROOT/$PARTNER_ENV_FILE" | head -1 | cut -d= -f2-
}

start_partner() {
  local net="$1"
  partner_dev_env
  docker rm -f mn-condition-partner >/dev/null 2>&1 || true
  MSYS_NO_PATHCONV=1 docker run -d --name mn-condition-partner -w /app -p 8788:8788 \
    --network "$net" \
    -v "${HOSTPATH}:/app" \
    -v "${SDK_VOLUME}:/app/node_modules" \
    -v /app/packages/shared/node_modules \
    -v /app/packages/db/node_modules \
    -v /app/apps/partner-mock/node_modules \
    -v "${PARTNER_DATA_VOLUME}:/partner" \
    -e PARTNER_DB_URL=file:/partner/partner.db \
    -e PARTNER_SIGNING_KEY="$(partner_env_value PARTNER_SIGNING_KEY)" \
    -e PARTNER_API_KEY="$(partner_env_value PARTNER_API_KEY)" \
    -e PARTNER_ALLOWED_ORIGIN=http://localhost:8787 \
    "$IMAGE" npx --no-install tsx apps/partner-mock/src/server.ts >/dev/null
  local i
  for i in $(seq 1 60); do
    if docker exec mn-condition-partner sh -c 'curl -sf http://127.0.0.1:8788/health >/dev/null' 2>/dev/null; then
      echo "partner mock: http://localhost:8788"
      return 0
    fi
    sleep 1
  done
  echo "partner mock did not come up" >&2
  docker logs --tail 40 mn-condition-partner
  return 1
}

preprod_proof_server() {
  docker network inspect "$PREPROD_NET" >/dev/null 2>&1 || docker network create "$PREPROD_NET" >/dev/null
  if [ -z "$(docker ps -q -f "name=^${PREPROD_PROOF}$")" ]; then
    docker rm -f "$PREPROD_PROOF" >/dev/null 2>&1 || true
    docker run -d --name "$PREPROD_PROOF" --network "$PREPROD_NET" \
      "$PROOF_SERVER_IMAGE" midnight-proof-server -v >/dev/null
    echo "started $PREPROD_PROOF ($PROOF_SERVER_IMAGE)"
  fi
}

lane_deploy_preprod() {
  local step="${1:-all}"
  case "$step" in
    all|wallet|funding|deploy|status) ;;
    *) echo "unknown deploy_preprod step: $step (wallet | funding | deploy | status)" >&2; return 2 ;;
  esac
  [ -f "$ROOT/$PREPROD_ENV_FILE" ] || {
    echo "$PREPROD_ENV_FILE is missing - see docs/deploy_preprod.md" >&2
    return 1
  }
  preprod_proof_server

  docker rm -f mn-condition-preprod >/dev/null 2>&1 || true
  MSYS_NO_PATHCONV=1 docker run --rm --name mn-condition-preprod -w /app \
    --network "$PREPROD_NET" \
    -v "${HOSTPATH}:/app" \
    -v "${SDK_VOLUME}:/app/node_modules" \
    -v "${TOOLCHAIN_VOLUME}:/opt/compact" \
    -v /app/packages/shared/node_modules \
    -v /app/packages/db/node_modules \
    -v /app/packages/condition-read/node_modules \
    -v /app/packages/ingester-core/node_modules \
    -v /app/packages/midnight-chain/node_modules \
    -v /app/contracts/condition-registry/node_modules \
    -v /app/apps/ingester/node_modules \
    -v /app/apps/gateway/node_modules \
    -v /app/apps/partner-mock/node_modules \
    -v /app/apps/development/condition-cli/node_modules \
    -e MIDNIGHT_HOST_ROLE=development \
    -e DEVELOPMENT_ENV_FILE="$PREPROD_ENV_FILE" \
    -e MIDNIGHT_NETWORK=preprod \
    -e MIDNIGHT_PROOF_SERVER_URL="http://${PREPROD_PROOF}:6300" \
    -e STEP="$step" \
    "$IMAGE" bash -euo pipefail -c "
      [ -d node_modules/@midnight-ntwrk/wallet-sdk ] || npm ci \
        --workspace @midnight-demo/shared --workspace @midnight-demo/db \
        --workspace @midnight-demo/condition-read --workspace @midnight-demo/ingester-core \
        --workspace @midnight-demo/ingester --workspace @midnight-demo/condition-registry-contract \
        --workspace @midnight-demo/midnight-chain --workspace @midnight-demo/condition-cli \
        --workspace @midnight-demo/gateway --workspace @midnight-demo/partner-mock \
        --include-workspace-root=true --no-audit --no-fund

      cli() {
        npx tsx apps/development/condition-cli/src/cli.ts \"\$@\" 2>&1 \
          | sed -u '/recovery phrase:/{n;s/.*/  (written to $PREPROD_ENV_FILE - back that file up)/}'
      }

      if [ \"\$STEP\" = all ] || [ \"\$STEP\" = deploy ]; then
        if [ ! -x /opt/compact/compactc ]; then
          echo '== fetching Compact toolchain 0.31.1 =='
          apt-get -qq update >/dev/null && apt-get -qq install -y unzip >/dev/null
          curl -fL --retry 3 -o /tmp/compactc.zip '$COMPACTC_URL'
          echo '$COMPACTC_SHA256  /tmp/compactc.zip' | sha256sum -c -
          (cd /opt/compact && unzip -oq /tmp/compactc.zip && chmod +x compactc compactc.bin zkir zkir-v3 fixup-compact format-compact)
        fi
        export PATH=/opt/compact:\$PATH
        if [ ! -f contracts/condition-registry/src/managed/condition-registry/contract/index.js ]; then
          echo \"== compile condition-registry (compactc \$(compactc --version)) ==\"
          compactc contracts/condition-registry/src/condition-registry.compact \
                   contracts/condition-registry/src/managed/condition-registry
        fi
      fi

      case \"\$STEP\" in
        wallet)  cli wallet ;;
        funding) cli funding ;;
        deploy)  cli deploy; cli status ;;
        status)  cli status ;;
        all)     cli funding; cli deploy; cli status ;;
      esac
      echo 'PREPROD OK'
    "
}

lane_test() {
  MSYS_NO_PATHCONV=1 docker run --rm -w /app "${MOUNTS[@]}" "$IMAGE" bash -euo pipefail -c "
    $INSTALL
    for ws in $OFFLINE_WS; do
      echo \"=== \$ws ===\"
      npm run test -w \"\$ws\"
    done
    echo '=== typecheck ==='
    for ws in $OFFLINE_WS; do
      npm run typecheck -w \"\$ws\"
    done
    echo 'ALL GREEN'
  "
}

lane_test_sdk() {
  # Typecheck + test the Midnight-SDK workspaces that are NOT in the fast `test`
  # lane. Pulls the full Midnight SDK into its own volume - a few minutes on the
  # first run, cached after. No proof server, wallet, or chain.
  MSYS_NO_PATHCONV=1 docker run --rm -w /app \
    -v "${HOSTPATH}:/app" \
    -v "${SDK_VOLUME}:/app/node_modules" \
    -v /app/packages/shared/node_modules \
    -v /app/packages/db/node_modules \
    -v /app/packages/condition-read/node_modules \
    -v /app/packages/ingester-core/node_modules \
    -v /app/packages/midnight-chain/node_modules \
    -v /app/contracts/condition-registry/node_modules \
    -v /app/contracts/condition-registry/src/managed \
    -v /app/apps/ingester/node_modules \
    -v /app/apps/gateway/node_modules \
    -v /app/apps/partner-mock/node_modules \
    -v /app/apps/development/condition-cli/node_modules \
    -e MIDNIGHT_HOST_ROLE=development \
    "$IMAGE" bash -euo pipefail -c "
      [ -d node_modules/@midnight-ntwrk/wallet-sdk ] || npm ci \
        --workspace @midnight-demo/shared \
        --workspace @midnight-demo/db \
        --workspace @midnight-demo/condition-read \
        --workspace @midnight-demo/ingester-core \
        --workspace @midnight-demo/ingester \
        --workspace @midnight-demo/condition-registry-contract \
        --workspace @midnight-demo/midnight-chain \
        --workspace @midnight-demo/condition-cli \
        --workspace @midnight-demo/gateway --workspace @midnight-demo/partner-mock \
        --include-workspace-root=true --no-audit --no-fund
      echo '== typecheck: @midnight-demo/midnight-chain =='
      npm run typecheck -w @midnight-demo/midnight-chain
      echo '== typecheck: @midnight-demo/condition-cli =='
      npm run typecheck -w @midnight-demo/condition-cli
      echo '== test: @midnight-demo/midnight-chain =='
      npm run test -w @midnight-demo/midnight-chain
      echo '== test: @midnight-demo/condition-cli =='
      npm run test -w @midnight-demo/condition-cli
      echo 'SDK OK'
    "
}

lane_test_contract() {
  # Compile condition-registry into src/managed/ (TypeScript contract + zkir
  # circuits + proving/verifying keys), then run the in-process ZK-circuit test
  # suite. No proof server, wallet, or chain.
  MSYS_NO_PATHCONV=1 docker run --rm -w /app \
    -v "${HOSTPATH}:/app" \
    -v "${TOOLCHAIN_VOLUME}:/opt/compact" \
    -v "${CONTRACT_VOLUME}:/app/node_modules" \
    -v /app/packages/shared/node_modules \
    -v /app/contracts/condition-registry/node_modules \
    -v /app/contracts/condition-registry/src/managed \
    "$IMAGE" bash -euo pipefail -c "
      if [ ! -x /opt/compact/compactc ]; then
        echo '== fetching Compact toolchain 0.31.1 =='
        apt-get -qq update >/dev/null && apt-get -qq install -y unzip >/dev/null
        curl -fL --retry 3 -o /tmp/compactc.zip '$COMPACTC_URL'
        echo '$COMPACTC_SHA256  /tmp/compactc.zip' | sha256sum -c -
        (cd /opt/compact && unzip -oq /tmp/compactc.zip && chmod +x compactc compactc.bin zkir zkir-v3 fixup-compact format-compact)
      fi
      export PATH=/opt/compact:\$PATH
      echo \"compactc \$(compactc --version)  (language \$(compactc --language-version))\"
      [ -d node_modules/vitest ] || npm ci \
        --workspace @midnight-demo/condition-registry-contract \
        --workspace @midnight-demo/shared \
        --include-workspace-root=true --no-audit --no-fund
      echo '== compile: condition-registry =='
      compactc contracts/condition-registry/src/condition-registry.compact \
               contracts/condition-registry/src/managed/condition-registry
      echo '== circuit tests: condition-registry =='
      npm run test -w @midnight-demo/condition-registry-contract
      npm run typecheck -w @midnight-demo/condition-registry-contract
      echo 'CONTRACT OK'
    "
}

lane_db() {
  # End-to-end against a real local libSQL server in Docker (mirrors production
  # Uses a private docker network so the ingester container
  # reaches the server by name.
  NET=mn-condition-net
  docker network create "$NET" >/dev/null 2>&1 || true
  docker rm -f mn-condition-libsql >/dev/null 2>&1 || true
  docker run -d --name mn-condition-libsql --network "$NET" \
    "ghcr.io/tursodatabase/libsql-server:latest" >/dev/null
  echo "started libsql server (mn-condition-libsql:8080); warming up ..."
  sleep 6
  local rc=0
  MSYS_NO_PATHCONV=1 docker run --rm -w /app --network "$NET" "${MOUNTS[@]}" \
    -e INGESTER_SALT_HEX="${INGESTER_SALT_HEX:-5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a}" \
    -e LIBSQL_URL="http://mn-condition-libsql:8080" \
    "$IMAGE" bash -c "
      $INSTALL
      npm run --silent seed -w @midnight-demo/ingester -- --sample
      echo '--- record --local (writes submissions to the libsql server) ---'
      npm run --silent record -w @midnight-demo/ingester -- --local
      echo; echo '--- plan again: reads back from libsql, expects 2 already-submitted ---'
      npm run --silent plan -w @midnight-demo/ingester
    " || rc=$?
  docker rm -f mn-condition-libsql >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
  echo "removed libsql server + network"
  return $rc
}

lane_devnet() {
  local compose="$ROOT/ops/local/midnight-compose.yml"
  docker compose -f "$compose" up -d
  echo "waiting for healthchecks (node:9944 / indexer:8088 / proof-server:6300) ..."
  local i states healthy
  for i in $(seq 1 60); do
    states=$(docker inspect -f '{{.Name}} {{if .State.Health}}{{.State.Health.Status}}{{else}}nohealth{{end}}' \
      midnight-node midnight-indexer midnight-proof-server 2>/dev/null || true)
    echo "$states"
    healthy=$(printf '%s\n' "$states" | grep -cE ' healthy$' || true)
    if [ "$healthy" = 3 ]; then echo "devnet is healthy"; return 0; fi
    [ "$i" = 60 ] && { echo "devnet did not become healthy in time" >&2; return 1; }
    sleep 3
  done
}

devnet_running() {
  docker ps --format '{{.Names}}' | grep -q '^midnight-node$'
}

lane_integrate() {
  # END-TO-END: the local DB wired to a real condition-registry contract on the
  # local devnet. One container joined to the devnet network runs:
  #   compile -> fund the operating wallet from the genesis seed -> deploy ->
  #   ingester seed -> submit the planned (ring, day) conditions on-chain ->
  #   reconcile the `submissions` local copy against the chain -> dump the ledger.
  # DB: libSQL on the `mn-condition-e2e-data` volume. Wallet sync state + the
  # deployment record persist under .state/midnight-chain/.
  devnet_running || { echo "devnet is not running - run.sh devnet (or run.sh e2e)" >&2; return 1; }
  [ -f "$ROOT/.env" ] || { echo ".env is missing - cp .env.example .env and set MIDNIGHT_NETWORK=local" >&2; return 1; }
  local devnet_net
  devnet_net=$(docker inspect midnight-node --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}')

  docker rm -f mn-condition-integrate >/dev/null 2>&1 || true
  MSYS_NO_PATHCONV=1 docker run --rm --name mn-condition-integrate -w /app \
    --network "$devnet_net" \
    -v "${HOSTPATH}:/app" \
    -v "${SDK_VOLUME}:/app/node_modules" \
    -v "${TOOLCHAIN_VOLUME}:/opt/compact" \
    -v /app/packages/shared/node_modules \
    -v /app/packages/db/node_modules \
    -v /app/packages/condition-read/node_modules \
    -v /app/packages/ingester-core/node_modules \
    -v /app/packages/midnight-chain/node_modules \
    -v /app/contracts/condition-registry/node_modules \
    -v /app/apps/ingester/node_modules \
    -v /app/apps/gateway/node_modules \
    -v /app/apps/partner-mock/node_modules \
    -v /app/apps/development/condition-cli/node_modules \
    -v "${E2E_DB_VOLUME}:/e2e" \
    -e RESUME="${RESUME:-}" \
    -e MIDNIGHT_HOST_ROLE=development \
    -e MIDNIGHT_NETWORK=local \
    -e MIDNIGHT_NODE_URL=http://node:9944 \
    -e MIDNIGHT_INDEXER_URL=http://indexer:8088/api/v4/graphql \
    -e MIDNIGHT_INDEXER_WS_URL=ws://indexer:8088/api/v4/graphql/ws \
    -e MIDNIGHT_PROOF_SERVER_URL=http://proof-server:6300 \
    -e LIBSQL_URL="file:/e2e/ingester.db" \
    "$IMAGE" bash -euo pipefail -c "
      [ -d node_modules/@midnight-ntwrk/wallet-sdk ] || npm ci \
        --workspace @midnight-demo/shared --workspace @midnight-demo/db \
        --workspace @midnight-demo/condition-read --workspace @midnight-demo/ingester-core \
        --workspace @midnight-demo/ingester --workspace @midnight-demo/condition-registry-contract \
        --workspace @midnight-demo/midnight-chain --workspace @midnight-demo/condition-cli \
        --workspace @midnight-demo/gateway --workspace @midnight-demo/partner-mock \
        --include-workspace-root=true --no-audit --no-fund

      if [ ! -x /opt/compact/compactc ]; then
        echo '== fetching Compact toolchain 0.31.1 =='
        apt-get -qq update >/dev/null && apt-get -qq install -y unzip >/dev/null
        curl -fL --retry 3 -o /tmp/compactc.zip '$COMPACTC_URL'
        echo '$COMPACTC_SHA256  /tmp/compactc.zip' | sha256sum -c -
        (cd /opt/compact && unzip -oq /tmp/compactc.zip && chmod +x compactc compactc.bin zkir zkir-v3 fixup-compact format-compact)
      fi
      export PATH=/opt/compact:\$PATH
      if [ ! -f contracts/condition-registry/src/managed/condition-registry/contract/index.js ]; then
        echo \"== compile condition-registry (compactc \$(compactc --version)) ==\"
        compactc contracts/condition-registry/src/condition-registry.compact \
                 contracts/condition-registry/src/managed/condition-registry
      fi

      CLI=apps/development/condition-cli/src/cli.ts
      rm -f /e2e/ingester.db /e2e/ingester.db-shm /e2e/ingester.db-wal

      if [ \"\${RESUME:-}\" != 1 ] || [ ! -f .state/midnight-chain/deployment-local.json ]; then
        rm -rf .state/midnight-chain/wallet-sync/local
        echo '== fund the operating wallet from the genesis seed =='
        npx tsx \"\$CLI\" fund
        echo '== deploy condition-registry =='
        npx tsx \"\$CLI\" deploy
      else
        echo '== reusing the existing deployment (.state/midnight-chain/deployment-local.json) =='
        grep -o '\"contractAddress\": \"[^\"]*\"' .state/midnight-chain/deployment-local.json
      fi
      echo '== ingester seed (roster only — the staged feed is operator-driven) =='
      npm run --silent seed -w @midnight-demo/ingester
      echo '== submit planned conditions on-chain + reconcile the local copy =='
      npx tsx \"\$CLI\" submit
      echo '== on-chain condition-registry ledger =='
      npx tsx \"\$CLI\" status
      echo 'E2E OK'
    "
}

lane_dashboard() {
  # The last step of `run.sh e2e`: serve the dashboard SPA + the read API from
  # one Node process (matches the production Worker: same origin for assets
  # and /api/*), joined to the local devnet with its deployed
  # condition-registry contract. Not an independent lane - always called from
  # lane_e2e, after the devnet is up and a contract is deployed. Detached.
  docker rm -f mn-condition-dashboard >/dev/null 2>&1 || true

  devnet_running || { echo "dashboard needs the devnet - run.sh e2e" >&2; return 1; }
  [ -f "$ROOT/.state/midnight-chain/deployment-local.json" ] || {
    echo "no deployed contract - run.sh e2e first" >&2; return 1; }
  local e2e_addr
  e2e_addr=$(grep -oE '[0-9a-f]{64}' "$ROOT/.state/midnight-chain/deployment-local.json" | head -1)
  local dash_net dash_db dash_chain
  dash_net=(--network "$(docker inspect midnight-node --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}')")
  dash_db=(-v "${E2E_DB_VOLUME}:/e2e" -e LIBSQL_URL="file:/e2e/ingester.db")
  dash_chain=(
    -e MIDNIGHT_NETWORK=local
    -e CONDITION_REGISTRY_CONTRACT_ADDRESS="$e2e_addr"
    -e MIDNIGHT_NODE_URL=http://node:9944
    -e MIDNIGHT_INDEXER_URL=http://indexer:8088/api/v4/graphql
    -e MIDNIGHT_INDEXER_WS_URL=ws://indexer:8088/api/v4/graphql/ws
    -e MIDNIGHT_PROOF_SERVER_URL=http://proof-server:6300
  )
  echo "dashboard: joined to the devnet (contract $e2e_addr)"
  start_partner "${dash_net[1]}"

  MSYS_NO_PATHCONV=1 docker run -d --name mn-condition-dashboard -w /app -p 8787:8787 \
    "${dash_net[@]}" \
    -v "${HOSTPATH}:/app" \
    -v "${SDK_VOLUME}:/app/node_modules" \
    -v /app/packages/shared/node_modules \
    -v /app/packages/db/node_modules \
    -v /app/packages/condition-read/node_modules \
    -v /app/packages/ingester-core/node_modules \
    -v /app/packages/midnight-chain/node_modules \
    -v /app/contracts/condition-registry/node_modules \
    -v /app/apps/ingester/node_modules \
    -v /app/apps/gateway/node_modules \
    -v /app/apps/partner-mock/node_modules \
    -v /app/apps/development/condition-cli/node_modules \
    "${dash_db[@]}" \
    "${dash_chain[@]}" \
    -e MIDNIGHT_HOST_ROLE=development \
    -e INGESTER_SALT_HEX="${INGESTER_SALT_HEX:-5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a}" \
    -e PUBLIC_MIDNIGHT_NETWORK="${PUBLIC_MIDNIGHT_NETWORK:-Midnight Local}" \
    -e PUBLIC_MIDNIGHT_EXPLORER_URL="${PUBLIC_MIDNIGHT_EXPLORER_URL:-}" \
    -e DEVELOPMENT_PRIVATE_STATE_PASSWORD="${DEVELOPMENT_PRIVATE_STATE_PASSWORD:-Aa1!worksite-condition-devnet}" \
    -e PARTNER_URL=http://mn-condition-partner:8788 \
    -e PUBLIC_PARTNER_URL=http://localhost:8788 \
    -e PARTNER_API_KEY="$(partner_env_value PARTNER_API_KEY)" \
    -e PARTNER_PUBLIC_KEY="$(partner_env_value PARTNER_PUBLIC_KEY)" \
    "$IMAGE" bash -c "
      [ -d node_modules/@midnight-ntwrk/wallet-sdk ] || npm ci \
        --workspace @midnight-demo/shared --workspace @midnight-demo/db \
        --workspace @midnight-demo/condition-read --workspace @midnight-demo/ingester-core \
        --workspace @midnight-demo/ingester --workspace @midnight-demo/condition-registry-contract \
        --workspace @midnight-demo/midnight-chain --workspace @midnight-demo/condition-cli \
        --workspace @midnight-demo/gateway --workspace @midnight-demo/partner-mock \
        --include-workspace-root=true --no-audit --no-fund
      exec npm run --silent serve -w @midnight-demo/gateway
    " >/dev/null
  echo "starting (first run installs the Midnight SDK - a few minutes) ..."
  local i
  for i in $(seq 1 240); do
    if docker exec mn-condition-dashboard sh -c 'curl -sf http://127.0.0.1:8787/api/config >/dev/null' 2>/dev/null; then
      break
    fi
    if ! docker ps --format '{{.Names}}' | grep -q '^mn-condition-dashboard$'; then
      echo "container exited" >&2; docker logs mn-condition-dashboard; return 1
    fi
    [ "$i" = 240 ] && { echo "dashboard did not come up" >&2; docker logs --tail 40 mn-condition-dashboard; return 1; }
    sleep 2
  done
  echo "dashboard:  http://localhost:8787"
  echo "logs:       docker logs -f mn-condition-dashboard"
  echo "partner:    docker exec mn-condition-partner npx tsx apps/partner-mock/src/cli.ts simulate --rings <ring-id>"
  echo "restart:    RESUME=1 ./run.sh e2e   (keeps the devnet + deployed contract)"
  echo "stop:       ./run.sh down"
}

lane_e2e() {
  devnet_running || lane_devnet
  lane_integrate
  lane_dashboard
}

usage() {
  sed -n '/^# Usage/,/^set -euo/p' "${BASH_SOURCE[0]}" | sed '$d' >&2
}

# ---------------------------------------------------------------------------
# lane resolution: positional arg wins, else $MODE_ENV
# ---------------------------------------------------------------------------
lane="${1:-${MODE_ENV:-}}"
lane="${lane#--}"                     # --down -> down
lane="${lane#"${lane%%[![:space:]]*}"}"; lane="${lane%"${lane##*[![:space:]]}"}"  # trim
case "$lane" in
  sdk)       lane=test_sdk ;;         # deprecated aliases
  contract)  lane=test_contract ;;
  integrate) lane=e2e ;;
  dashboard) lane=e2e; RESUME="${RESUME:-1}" ;;
esac

case "$lane" in
  down|clean)     lane_down "$lane" ;;
  test)          lane_test ;;
  test_sdk)      lane_test_sdk ;;
  test_contract) lane_test_contract ;;
  test_all)      lane_test; lane_test_sdk; lane_test_contract ;;
  db)            lane_db ;;
  devnet)        lane_devnet ;;
  e2e)           lane_e2e ;;
  deploy_preprod) lane_deploy_preprod "${2:-}" ;;
  '')            echo "no lane (pass one, or set MODE_ENV)" >&2; usage; exit 2 ;;
  *)             echo "unknown lane: $lane" >&2; usage; exit 2 ;;
esac
