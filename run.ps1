#Requires -Version 5.1
<#
  run.ps1 - native Windows entry point for the worksite-condition harness.

  A faithful port of run.sh: PowerShell drives the host side (docker CLI, paths,
  wait loops); each lane's actual work runs as bash INSIDE the throwaway
  `node:22-bookworm` Linux container (the container scripts are passed base64 so
  PowerShell's native-arg quirks can't corrupt them). No Git Bash / WSL needed,
  only Docker Desktop.

  Usage:
      .\run.ps1 <lane>
      $env:MODE_ENV = '<lane>' ; .\run.ps1        # lane from the env
      (MODE_ENV / RESUME are also read from .env / .env.local when unset)

  Lanes:
      test           unit tests + typecheck (SDK-free workspaces) - fast
      test_sdk       typecheck + tests for the Midnight-SDK workspaces
      test_contract  compile condition-registry + run its ZK-circuit tests
      test_all       test + test_sdk + test_contract
      db             ingester end-to-end against a docker libSQL server
      devnet         bring up the local Midnight devnet
      e2e            ONE COMMAND: devnet -> fund -> deploy -> dashboard on :8787,
                     joined to the deployed contract
                     ($env:RESUME = 1 skips fund/deploy and reuses the deployment
                     and dashboard - use this to just restart the dashboard)
      deploy_preprod [wallet|funding|deploy|status]
                     deploy condition-registry to Midnight preprod with the wallet
                     in .env.preprod (no step = funding -> deploy -> status)
      down / clean   stop containers / also delete volumes

  Aliases (deprecated): sdk->test_sdk, contract->test_contract, integrate->e2e,
                        dashboard->e2e, --down->down, --clean->clean
#>

[CmdletBinding()]
param(
  [Parameter(Position = 0)] [string] $Command = '',
  [Parameter(ValueFromRemainingArguments = $true)] [string[]] $Rest
)

# 'Continue', not 'Stop': docker cleanup calls (`rm -f` a missing container, etc.)
# write to stderr and exit non-zero by design - like run.sh's `|| true`. Real
# failures are caught by explicit `$LASTEXITCODE` checks and `Fail`.
$ErrorActionPreference = 'Continue'
Set-StrictMode -Version 2.0
$PSNativeCommandUseErrorActionPreference = $false

# ---------------------------------------------------------------------------
# constants
# ---------------------------------------------------------------------------
$Volume         = 'mn-condition-node-modules'
$ContractVolume = 'mn-condition-contract-node-modules'
$SdkVolume      = 'mn-condition-sdk-node-modules'
$ToolchainVol   = 'mn-compact-toolchain'
$E2eDbVolume    = 'mn-condition-e2e-data'
$Image          = 'node:22-bookworm'
$PreprodEnvFile = '.env.preprod'
$PreprodNet     = 'mn-condition-preprod-net'
$PreprodProof   = 'mn-condition-preprod-proof'
$ProofImage     = 'midnightntwrk/proof-server:8.1.0'
$PartnerDataVolume = 'mn-condition-partner-data'
$PartnerEnvFile    = '.state/partner-mock/dev.env'

$CompactcUrl = 'https://github.com/midnightntwrk/compact/releases/download/compactc-v0.31.1/compactc_v0.31.1_x86_64-unknown-linux-musl.zip'
$CompactcSha = 'e291b4bab4d4e857707008f8b1c25c2b8e0c843f6c737d0ee6c0d9ac69a6bbfb'

$Root    = (Resolve-Path $PSScriptRoot -ErrorAction Stop).Path
$Compose = Join-Path $Root 'ops\local\midnight-compose.yml'

# The harness lane controls (MODE_ENV / RESUME) may also be pinned in
# .env / .env.local so a checkout has a default lane without re-setting $env: each
# shell. A real $env: var always wins; .env.local wins over .env; the positional
# arg still wins over MODE_ENV.
function Import-HarnessEnv {
  foreach ($file in @((Join-Path $Root '.env.local'), (Join-Path $Root '.env'))) {
    if (-not (Test-Path -LiteralPath $file)) { continue }
    foreach ($line in (Get-Content -LiteralPath $file)) {
      $t = $line.Trim()
      if ($t -eq '' -or $t.StartsWith('#')) { continue }
      if ($t -notmatch '^(?:export\s+)?(MODE_ENV|RESUME)\s*=\s*(.*)$') { continue }
      $key = $Matches[1]
      if ([Environment]::GetEnvironmentVariable($key, 'Process')) { continue }
      $val = ($Matches[2] -replace '\s+#.*$', '').Trim()
      $val = $val -replace '^"(.*)"$', '$1' -replace "^'(.*)'$", '$1'
      if ($val -ne '') { Set-Item -Path "Env:$key" -Value $val }
    }
  }
}
Import-HarnessEnv

$OfflineWs = '@midnight-demo/shared @midnight-demo/db @midnight-demo/condition-read @midnight-demo/ingester-core @midnight-demo/ingester @midnight-demo/gateway @midnight-demo/partner-mock'
$Install   = '[ -d node_modules/tsx ] || npm ci --workspace @midnight-demo/shared --workspace @midnight-demo/db --workspace @midnight-demo/condition-read --workspace @midnight-demo/ingester-core --workspace @midnight-demo/ingester --workspace @midnight-demo/gateway --workspace @midnight-demo/partner-mock --include-workspace-root=true --no-audit --no-fund'
$Salt      = if ($env:INGESTER_SALT_HEX) { $env:INGESTER_SALT_HEX } else { '5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a' }

$Mounts = @(
  '-v', "${Root}:/app"
  '-v', "${Volume}:/app/node_modules"
  '-v', '/app/packages/shared/node_modules'
  '-v', '/app/packages/db/node_modules'
  '-v', '/app/packages/ingester-core/node_modules'
  '-v', '/app/packages/condition-read/node_modules'
  '-v', '/app/apps/ingester/node_modules'
  '-v', '/app/apps/gateway/node_modules'
  '-v', '/app/apps/partner-mock/node_modules'
)

# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------
function Fail([string]$msg) { [Console]::Error.WriteLine($msg); exit 1 }

# Run a bash script in a fresh container; the script is handed over base64 so
# PowerShell never quotes a multi-line shell string on the command line. Leaves
# the result in $LASTEXITCODE (no return / no exit).
function Invoke-Bash {
  param([string[]] $DockerArgs, [string] $Script, [switch] $Strict)
  if ($Strict) { $Script = "set -euo pipefail`n" + $Script }
  $b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($Script))
  $dArgs = @('run') + $DockerArgs + @($Image, 'bash', '-c', "echo $b64 | base64 -d | bash")
  & docker @dArgs
}

function Devnet-Running {
  ((& docker ps --format '{{.Names}}' 2>$null) -split "`r?`n") -contains 'midnight-node'
}
function Devnet-Network {
  (& docker inspect midnight-node --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}').Trim()
}

# The compactc-fetch bash block, shared by test_contract and integrate.
function Compactc-Fetch {
@"
if [ ! -x /opt/compact/compactc ]; then
  echo '== fetching Compact toolchain 0.31.1 =='
  apt-get -qq update >/dev/null && apt-get -qq install -y unzip >/dev/null
  curl -fL --retry 3 -o /tmp/compactc.zip '$CompactcUrl'
  echo '$CompactcSha  /tmp/compactc.zip' | sha256sum -c -
  (cd /opt/compact && unzip -oq /tmp/compactc.zip && chmod +x compactc compactc.bin zkir zkir-v3 fixup-compact format-compact)
fi
export PATH=/opt/compact:`$PATH
"@
}

# ---------------------------------------------------------------------------
# lanes
# ---------------------------------------------------------------------------
function Lane-Down([string]$which) {
  & docker rm -f mn-condition-libsql mn-condition-dashboard mn-condition-partner mn-condition-integrate mn-condition-preprod $PreprodProof 2>$null | Out-Null
  & docker network rm mn-condition-net $PreprodNet 2>$null | Out-Null
  & docker compose -f $Compose down 2>$null | Out-Null
  Write-Host 'removed containers'
  if ($which -eq 'clean') {
    & docker volume rm $Volume $ContractVolume $SdkVolume $ToolchainVol $E2eDbVolume $PartnerDataVolume 2>$null | Out-Null
    Write-Host 'removed volumes (next run reinstalls)'
  }
}

function Lane-Test {
  $script = @"
$Install
for ws in $OfflineWs; do
  echo "=== `$ws ==="
  npm run test -w "`$ws"
done
echo '=== typecheck ==='
for ws in $OfflineWs; do
  npm run typecheck -w "`$ws"
done
echo 'ALL GREEN'
"@
  Invoke-Bash -DockerArgs (@('--rm', '-w', '/app') + $Mounts) -Script $script -Strict
}

function Lane-TestSdk {
  $d = @(
    '--rm', '-w', '/app'
    '-v', "${Root}:/app"
    '-v', "${SdkVolume}:/app/node_modules"
    '-v', '/app/packages/shared/node_modules'
    '-v', '/app/packages/db/node_modules'
    '-v', '/app/packages/condition-read/node_modules'
    '-v', '/app/packages/ingester-core/node_modules'
    '-v', '/app/packages/midnight-chain/node_modules'
    '-v', '/app/contracts/condition-registry/node_modules'
    '-v', '/app/contracts/condition-registry/src/managed'
    '-v', '/app/apps/ingester/node_modules'
    '-v', '/app/apps/gateway/node_modules'
    '-v', '/app/apps/partner-mock/node_modules'
    '-v', '/app/apps/development/condition-cli/node_modules'
    '-e', 'MIDNIGHT_HOST_ROLE=development'
  )
  $script = @'
[ -d node_modules/@midnight-ntwrk/wallet-sdk ] || npm ci --workspace @midnight-demo/shared --workspace @midnight-demo/db --workspace @midnight-demo/condition-read --workspace @midnight-demo/ingester-core --workspace @midnight-demo/ingester --workspace @midnight-demo/condition-registry-contract --workspace @midnight-demo/midnight-chain --workspace @midnight-demo/condition-cli --workspace @midnight-demo/gateway --workspace @midnight-demo/partner-mock --include-workspace-root=true --no-audit --no-fund
echo '== typecheck: @midnight-demo/midnight-chain =='
npm run typecheck -w @midnight-demo/midnight-chain
echo '== typecheck: @midnight-demo/condition-cli =='
npm run typecheck -w @midnight-demo/condition-cli
echo '== test: @midnight-demo/midnight-chain =='
npm run test -w @midnight-demo/midnight-chain
echo '== test: @midnight-demo/condition-cli =='
npm run test -w @midnight-demo/condition-cli
echo 'SDK OK'
'@
  Invoke-Bash -DockerArgs $d -Script $script -Strict
}

function Lane-TestContract {
  $d = @(
    '--rm', '-w', '/app'
    '-v', "${Root}:/app"
    '-v', "${ToolchainVol}:/opt/compact"
    '-v', "${ContractVolume}:/app/node_modules"
    '-v', '/app/packages/shared/node_modules'
    '-v', '/app/contracts/condition-registry/node_modules'
    '-v', '/app/contracts/condition-registry/src/managed'
  )
  $script = (Compactc-Fetch) + "`n" + @'
echo "compactc $(compactc --version)  (language $(compactc --language-version))"
[ -d node_modules/vitest ] || npm ci --workspace @midnight-demo/condition-registry-contract --workspace @midnight-demo/shared --include-workspace-root=true --no-audit --no-fund
echo '== compile: condition-registry =='
compactc contracts/condition-registry/src/condition-registry.compact contracts/condition-registry/src/managed/condition-registry
echo '== circuit tests: condition-registry =='
npm run test -w @midnight-demo/condition-registry-contract
npm run typecheck -w @midnight-demo/condition-registry-contract
echo 'CONTRACT OK'
'@
  Invoke-Bash -DockerArgs $d -Script $script -Strict
}

function Lane-Db {
  $net = 'mn-condition-net'
  & docker network create $net 2>$null | Out-Null
  & docker rm -f mn-condition-libsql 2>$null | Out-Null
  & docker run -d --name mn-condition-libsql --network $net 'ghcr.io/tursodatabase/libsql-server:latest' | Out-Null
  Write-Host 'started libsql server (mn-condition-libsql:8080); warming up ...'
  Start-Sleep -Seconds 6
  $script = @"
$Install
npm run --silent seed -w @midnight-demo/ingester -- --sample
echo '--- record --local (writes submissions to the libsql server) ---'
npm run --silent record -w @midnight-demo/ingester -- --local
echo; echo '--- plan again: reads back from libsql, expects 2 already-submitted ---'
npm run --silent plan -w @midnight-demo/ingester
"@
  $d = @('--rm', '-w', '/app', '--network', $net) + $Mounts + @(
    '-e', "INGESTER_SALT_HEX=$Salt", '-e', 'LIBSQL_URL=http://mn-condition-libsql:8080'
  )
  Invoke-Bash -DockerArgs $d -Script $script
  $rc = $LASTEXITCODE
  & docker rm -f mn-condition-libsql 2>$null | Out-Null
  & docker network rm $net 2>$null | Out-Null
  Write-Host 'removed libsql server + network'
  exit $rc
}

function Start-Devnet {
  & docker compose -f $Compose up -d
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  Write-Host 'waiting for healthchecks (node:9944 / indexer:8088 / proof-server:6300) ...'
  for ($i = 1; $i -le 60; $i++) {
    $states = & docker inspect -f '{{.Name}} {{if .State.Health}}{{.State.Health.Status}}{{else}}nohealth{{end}}' midnight-node midnight-indexer midnight-proof-server 2>$null
    $states | ForEach-Object { Write-Host $_ }
    if (@($states | Where-Object { $_ -match ' healthy$' }).Count -eq 3) { Write-Host 'devnet is healthy'; return }
    if ($i -eq 60) { Fail 'devnet did not become healthy in time' }
    Start-Sleep -Seconds 3
  }
}

function Lane-Devnet {
  Start-Devnet
  Write-Host 'stop with: .\run.ps1 down'
}

function Lane-Integrate {
  if (-not (Devnet-Running)) { Fail 'devnet is not running - run.ps1 devnet (or run.ps1 e2e)' }
  if (-not (Test-Path (Join-Path $Root '.env'))) { Fail '.env is missing - copy .env.example to .env and set MIDNIGHT_NETWORK=local' }
  & docker rm -f mn-condition-integrate 2>$null | Out-Null
  $d = @(
    '--rm', '--name', 'mn-condition-integrate', '-w', '/app'
    '--network', (Devnet-Network)
    '-v', "${Root}:/app"
    '-v', "${SdkVolume}:/app/node_modules"
    '-v', "${ToolchainVol}:/opt/compact"
    '-v', '/app/packages/shared/node_modules'
    '-v', '/app/packages/db/node_modules'
    '-v', '/app/packages/condition-read/node_modules'
    '-v', '/app/packages/ingester-core/node_modules'
    '-v', '/app/packages/midnight-chain/node_modules'
    '-v', '/app/contracts/condition-registry/node_modules'
    '-v', '/app/apps/ingester/node_modules'
    '-v', '/app/apps/gateway/node_modules'
    '-v', '/app/apps/partner-mock/node_modules'
    '-v', '/app/apps/development/condition-cli/node_modules'
    '-v', "${E2eDbVolume}:/e2e"
    '-e', "RESUME=$($env:RESUME)"
    '-e', 'MIDNIGHT_HOST_ROLE=development'
    '-e', 'MIDNIGHT_NETWORK=local'
    '-e', 'MIDNIGHT_NODE_URL=http://node:9944'
    '-e', 'MIDNIGHT_INDEXER_URL=http://indexer:8088/api/v4/graphql'
    '-e', 'MIDNIGHT_INDEXER_WS_URL=ws://indexer:8088/api/v4/graphql/ws'
    '-e', 'MIDNIGHT_PROOF_SERVER_URL=http://proof-server:6300'
    '-e', 'LIBSQL_URL=file:/e2e/ingester.db'
  )
  $script = @"
[ -d node_modules/@midnight-ntwrk/wallet-sdk ] || npm ci --workspace @midnight-demo/shared --workspace @midnight-demo/db --workspace @midnight-demo/condition-read --workspace @midnight-demo/ingester-core --workspace @midnight-demo/ingester --workspace @midnight-demo/condition-registry-contract --workspace @midnight-demo/midnight-chain --workspace @midnight-demo/condition-cli --workspace @midnight-demo/gateway --workspace @midnight-demo/partner-mock --include-workspace-root=true --no-audit --no-fund

$(Compactc-Fetch)
if [ ! -f contracts/condition-registry/src/managed/condition-registry/contract/index.js ]; then
  echo "== compile condition-registry (compactc `$(compactc --version)) =="
  compactc contracts/condition-registry/src/condition-registry.compact contracts/condition-registry/src/managed/condition-registry
fi

CLI=apps/development/condition-cli/src/cli.ts
rm -f /e2e/ingester.db /e2e/ingester.db-shm /e2e/ingester.db-wal

if [ "`${RESUME:-}" != 1 ] || [ ! -f .state/midnight-chain/deployment-local.json ]; then
  rm -rf .state/midnight-chain/wallet-sync/local
  echo '== fund the operating wallet from the genesis seed =='
  npx tsx "`$CLI" fund
  echo '== deploy condition-registry =='
  npx tsx "`$CLI" deploy
else
  echo '== reusing the existing deployment (.state/midnight-chain/deployment-local.json) =='
  grep -o '"contractAddress": "[^"]*"' .state/midnight-chain/deployment-local.json
fi
echo '== ingester seed (roster only - the staged feed is operator-driven) =='
npm run --silent seed -w @midnight-demo/ingester
echo '== submit planned conditions on-chain + reconcile the local copy =='
npx tsx "`$CLI" submit
echo '== on-chain condition-registry ledger =='
npx tsx "`$CLI" status
echo 'E2E OK'
"@
  Invoke-Bash -DockerArgs $d -Script $script -Strict
}

function Lane-Dashboard {
  # The last step of Lane-E2E; not an independent lane - always called after
  # the devnet is up and a contract is deployed.
  & docker rm -f mn-condition-dashboard 2>$null | Out-Null

  if (-not (Devnet-Running)) { Fail 'dashboard needs the devnet - run.ps1 e2e' }
  $deployFile = Join-Path $Root '.state\midnight-chain\deployment-local.json'
  if (-not (Test-Path $deployFile)) { Fail 'no deployed contract - run.ps1 e2e first' }
  $e2eAddr = ([regex]::Match((Get-Content -Raw $deployFile), '[0-9a-f]{64}')).Value
  $dashNet   = @('--network', (Devnet-Network))
  $dashDb    = @('-v', "${E2eDbVolume}:/e2e", '-e', 'LIBSQL_URL=file:/e2e/ingester.db')
  $dashChain = @(
    '-e', 'MIDNIGHT_NETWORK=local'
    '-e', "CONDITION_REGISTRY_CONTRACT_ADDRESS=$e2eAddr"
    '-e', 'MIDNIGHT_NODE_URL=http://node:9944'
    '-e', 'MIDNIGHT_INDEXER_URL=http://indexer:8088/api/v4/graphql'
    '-e', 'MIDNIGHT_INDEXER_WS_URL=ws://indexer:8088/api/v4/graphql/ws'
    '-e', 'MIDNIGHT_PROOF_SERVER_URL=http://proof-server:6300'
  )
  Write-Host "dashboard: joined to the devnet (contract $e2eAddr)"
  Start-Partner (Devnet-Network)

  $pubNet = if ($env:PUBLIC_MIDNIGHT_NETWORK) { $env:PUBLIC_MIDNIGHT_NETWORK } else { 'Midnight Local' }
  $psp    = if ($env:DEVELOPMENT_PRIVATE_STATE_PASSWORD) { $env:DEVELOPMENT_PRIVATE_STATE_PASSWORD } else { 'Aa1!worksite-condition-devnet' }

  $script = @"
[ -d node_modules/@midnight-ntwrk/wallet-sdk ] || npm ci --workspace @midnight-demo/shared --workspace @midnight-demo/db --workspace @midnight-demo/condition-read --workspace @midnight-demo/ingester-core --workspace @midnight-demo/ingester --workspace @midnight-demo/condition-registry-contract --workspace @midnight-demo/midnight-chain --workspace @midnight-demo/condition-cli --workspace @midnight-demo/gateway --workspace @midnight-demo/partner-mock --include-workspace-root=true --no-audit --no-fund
exec npm run --silent serve -w @midnight-demo/gateway
"@

  $d = @('run', '-d', '--name', 'mn-condition-dashboard', '-w', '/app', '-p', '8787:8787') + $dashNet + @(
    '-v', "${Root}:/app"
    '-v', "${SdkVolume}:/app/node_modules"
    '-v', '/app/packages/shared/node_modules'
    '-v', '/app/packages/db/node_modules'
    '-v', '/app/packages/condition-read/node_modules'
    '-v', '/app/packages/ingester-core/node_modules'
    '-v', '/app/packages/midnight-chain/node_modules'
    '-v', '/app/contracts/condition-registry/node_modules'
    '-v', '/app/apps/ingester/node_modules'
    '-v', '/app/apps/gateway/node_modules'
    '-v', '/app/apps/partner-mock/node_modules'
    '-v', '/app/apps/development/condition-cli/node_modules'
  ) + $dashDb + $dashChain + @(
    '-e', 'MIDNIGHT_HOST_ROLE=development'
    '-e', "INGESTER_SALT_HEX=$Salt"
    '-e', "PUBLIC_MIDNIGHT_NETWORK=$pubNet"
    '-e', "PUBLIC_MIDNIGHT_EXPLORER_URL=$($env:PUBLIC_MIDNIGHT_EXPLORER_URL)"
    '-e', "DEVELOPMENT_PRIVATE_STATE_PASSWORD=$psp"
    '-e', 'PARTNER_URL=http://mn-condition-partner:8788'
    '-e', 'PUBLIC_PARTNER_URL=http://localhost:8788'
    '-e', "PARTNER_API_KEY=$(Partner-EnvValue 'PARTNER_API_KEY')"
    '-e', "PARTNER_PUBLIC_KEY=$(Partner-EnvValue 'PARTNER_PUBLIC_KEY')"
  )
  $b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($script))
  $da = $d + @($Image, 'bash', '-c', "echo $b64 | base64 -d | bash")
  & docker @da | Out-Null
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

  Write-Host 'starting (first run installs the Midnight SDK - a few minutes) ...'
  $ok = $false
  for ($i = 1; $i -le 240; $i++) {
    & docker exec mn-condition-dashboard sh -c 'curl -sf http://127.0.0.1:8787/api/config >/dev/null' 2>$null
    if ($LASTEXITCODE -eq 0) { $ok = $true; break }
    if (-not (((& docker ps --format '{{.Names}}' 2>$null) -split "`r?`n") -contains 'mn-condition-dashboard')) {
      & docker logs mn-condition-dashboard; Fail 'container exited'
    }
    Start-Sleep -Seconds 2
  }
  if (-not $ok) { & docker logs --tail 40 mn-condition-dashboard; Fail 'dashboard did not come up' }
  Write-Host 'dashboard:  http://localhost:8787'
  Write-Host 'logs:       docker logs -f mn-condition-dashboard'
  Write-Host 'partner:    docker exec mn-condition-partner npx tsx apps/partner-mock/src/cli.ts simulate --rings <ring-id>'
  Write-Host 'restart:    $env:RESUME=1; .\run.ps1 e2e   (keeps the devnet + deployed contract)'
  Write-Host 'stop:       .\run.ps1 down'
}

function Partner-DevEnv {
  $file = Join-Path $Root $PartnerEnvFile
  if ((Test-Path $file) -and (Get-Item $file).Length -gt 0) { return }
  New-Item -ItemType Directory -Force -Path (Split-Path $file) | Out-Null
  $lines = & docker run --rm -w /app -v "${Root}:/app" -v "${SdkVolume}:/app/node_modules" `
    -v /app/packages/shared/node_modules -v /app/apps/partner-mock/node_modules `
    $Image npx --no-install tsx apps/partner-mock/src/cli.ts keygen
  if ($LASTEXITCODE -ne 0) { Fail 'partner mock keygen failed' }
  [IO.File]::WriteAllLines($file, [string[]]$lines)
  Write-Host "generated partner mock dev keys ($PartnerEnvFile)"
}

function Partner-EnvValue([string]$name) {
  $line = Get-Content (Join-Path $Root $PartnerEnvFile) | Where-Object { $_ -like "$name=*" } | Select-Object -First 1
  if ($line) { $line.Substring($name.Length + 1) } else { '' }
}

function Start-Partner([string]$net) {
  Partner-DevEnv
  & docker rm -f mn-condition-partner 2>$null | Out-Null
  $d = @(
    'run', '-d', '--name', 'mn-condition-partner', '-w', '/app', '-p', '8788:8788', '--network', $net
    '-v', "${Root}:/app"
    '-v', "${SdkVolume}:/app/node_modules"
    '-v', '/app/packages/shared/node_modules'
    '-v', '/app/packages/db/node_modules'
    '-v', '/app/apps/partner-mock/node_modules'
    '-v', "${PartnerDataVolume}:/partner"
    '-e', 'PARTNER_DB_URL=file:/partner/partner.db'
    '-e', "PARTNER_SIGNING_KEY=$(Partner-EnvValue 'PARTNER_SIGNING_KEY')"
    '-e', "PARTNER_API_KEY=$(Partner-EnvValue 'PARTNER_API_KEY')"
    '-e', 'PARTNER_ALLOWED_ORIGIN=http://localhost:8787'
    $Image, 'npx', '--no-install', 'tsx', 'apps/partner-mock/src/server.ts'
  )
  & docker @d | Out-Null
  if ($LASTEXITCODE -ne 0) { Fail 'partner mock did not start' }
  for ($i = 1; $i -le 60; $i++) {
    & docker exec mn-condition-partner sh -c 'curl -sf http://127.0.0.1:8788/health >/dev/null' 2>$null
    if ($LASTEXITCODE -eq 0) { Write-Host 'partner mock: http://localhost:8788'; return }
    Start-Sleep -Seconds 1
  }
  & docker logs --tail 40 mn-condition-partner
  Fail 'partner mock did not come up'
}

function Start-PreprodProofServer {
  & docker network inspect $PreprodNet 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) { & docker network create $PreprodNet | Out-Null }
  $running = ((& docker ps --format '{{.Names}}' 2>$null) -split "`r?`n") -contains $PreprodProof
  if (-not $running) {
    & docker rm -f $PreprodProof 2>$null | Out-Null
    & docker run -d --name $PreprodProof --network $PreprodNet $ProofImage midnight-proof-server -v | Out-Null
    Write-Host "started $PreprodProof ($ProofImage)"
  }
}

function Lane-DeployPreprod([string]$step) {
  if (-not $step) { $step = 'all' }
  if ($step -notin 'all', 'wallet', 'funding', 'deploy', 'status') {
    [Console]::Error.WriteLine("unknown deploy_preprod step: $step (wallet | funding | deploy | status)")
    exit 2
  }
  if (-not (Test-Path (Join-Path $Root $PreprodEnvFile))) { Fail "$PreprodEnvFile is missing - see docs/deploy_preprod.md" }
  Start-PreprodProofServer
  & docker rm -f mn-condition-preprod 2>$null | Out-Null
  $d = @(
    '--rm', '--name', 'mn-condition-preprod', '-w', '/app'
    '--network', $PreprodNet
    '-v', "${Root}:/app"
    '-v', "${SdkVolume}:/app/node_modules"
    '-v', "${ToolchainVol}:/opt/compact"
    '-v', '/app/packages/shared/node_modules'
    '-v', '/app/packages/db/node_modules'
    '-v', '/app/packages/condition-read/node_modules'
    '-v', '/app/packages/ingester-core/node_modules'
    '-v', '/app/packages/midnight-chain/node_modules'
    '-v', '/app/contracts/condition-registry/node_modules'
    '-v', '/app/apps/ingester/node_modules'
    '-v', '/app/apps/gateway/node_modules'
    '-v', '/app/apps/partner-mock/node_modules'
    '-v', '/app/apps/development/condition-cli/node_modules'
    '-e', 'MIDNIGHT_HOST_ROLE=development'
    '-e', "DEVELOPMENT_ENV_FILE=$PreprodEnvFile"
    '-e', 'MIDNIGHT_NETWORK=preprod'
    '-e', "MIDNIGHT_PROOF_SERVER_URL=http://${PreprodProof}:6300"
    '-e', "STEP=$step"
  )
  $script = @"
[ -d node_modules/@midnight-ntwrk/wallet-sdk ] || npm ci --workspace @midnight-demo/shared --workspace @midnight-demo/db --workspace @midnight-demo/condition-read --workspace @midnight-demo/ingester-core --workspace @midnight-demo/ingester --workspace @midnight-demo/condition-registry-contract --workspace @midnight-demo/midnight-chain --workspace @midnight-demo/condition-cli --workspace @midnight-demo/gateway --workspace @midnight-demo/partner-mock --include-workspace-root=true --no-audit --no-fund

cli() {
  npx tsx apps/development/condition-cli/src/cli.ts "`$@" 2>&1 \
    | sed -u '/recovery phrase:/{n;s/.*/  (written to $PreprodEnvFile - back that file up)/}'
}

if [ "`$STEP" = all ] || [ "`$STEP" = deploy ]; then
$(Compactc-Fetch)
  if [ ! -f contracts/condition-registry/src/managed/condition-registry/contract/index.js ]; then
    echo "== compile condition-registry (compactc `$(compactc --version)) =="
    compactc contracts/condition-registry/src/condition-registry.compact contracts/condition-registry/src/managed/condition-registry
  fi
fi

case "`$STEP" in
  wallet)  cli wallet ;;
  funding) cli funding ;;
  deploy)  cli deploy; cli status ;;
  status)  cli status ;;
  all)     cli funding; cli deploy; cli status ;;
esac
echo 'PREPROD OK'
"@
  Invoke-Bash -DockerArgs $d -Script $script -Strict
}

function Lane-E2E {
  if (-not (Devnet-Running)) { Start-Devnet }
  Lane-Integrate
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  Lane-Dashboard
}

function Show-Usage {
  @'
run.ps1 <lane>   (or set $env:MODE_ENV)
  test  test_sdk  test_contract  test_all
  db  devnet  e2e  down  clean
  deploy_preprod [wallet|funding|deploy|status]
'@ | ForEach-Object { [Console]::Error.WriteLine($_) }
}

# ---------------------------------------------------------------------------
# lane resolution: positional arg wins, else $env:MODE_ENV
# ---------------------------------------------------------------------------
$lane = if ($Command) { $Command } elseif ($env:MODE_ENV) { $env:MODE_ENV } else { '' }
$lane = ($lane -replace '^--', '').Trim()
switch ($lane) {
  'sdk'       { $lane = 'test_sdk' }
  'contract'  { $lane = 'test_contract' }
  'integrate' { $lane = 'e2e' }
  'dashboard' { $lane = 'e2e'; if (-not $env:RESUME) { $env:RESUME = '1' } }
}

switch ($lane) {
  { $_ -in 'down', 'clean' } { Lane-Down $lane; break }
  'test'          { Lane-Test;          exit $LASTEXITCODE }
  'test_sdk'      { Lane-TestSdk;       exit $LASTEXITCODE }
  'test_contract' { Lane-TestContract;  exit $LASTEXITCODE }
  'test_all' {
    Lane-Test;         if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    Lane-TestSdk;      if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    Lane-TestContract; exit $LASTEXITCODE
  }
  'db'        { Lane-Db }
  'devnet'    { Lane-Devnet; break }
  'e2e'       { Lane-E2E; break }
  'deploy_preprod' {
    $step = if ($Rest) { $Rest[0] } else { '' }
    Lane-DeployPreprod $step; exit $LASTEXITCODE
  }
  ''      { [Console]::Error.WriteLine('no lane (pass one, or set $env:MODE_ENV)'); Show-Usage; exit 2 }
  default { [Console]::Error.WriteLine("unknown lane: $lane"); Show-Usage; exit 2 }
}
