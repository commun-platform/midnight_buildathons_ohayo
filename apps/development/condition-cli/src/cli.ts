import { config as loadEnv } from 'dotenv';
import path from 'node:path';

import fs from 'node:fs';
import { openIngesterDb } from '@midnight-demo/ingester/db';
import { loadAndPlan, summarize } from '@midnight-demo/ingester/pipeline';
import { reconcileSubmissions, type ReconcileResult } from '@midnight-demo/ingester/reconcile';
import { recordSubmissions, submissionRecord } from '@midnight-demo/ingester/store';
import {
  conditionChain,
  conditionContractAddress,
  createWallet,
  deployConditionRegistry,
  developmentEnvPath,
  ensureDust,
  fundFromGenesis,
  getOrCreateWalletCredentials,
  loadDeployment,
  persistWalletState,
  queryConditionRegistry,
  readConditionEntries,
  repoRoot,
  resolveNetwork,
  saveDeployment,
  submitCondition,
  syncWallet,
  waitForNightBalance,
  walletAddress,
  walletBalances,
  type NetworkConfig,
  type WalletContext,
} from '@midnight-demo/midnight-chain';
import { bytesToHex, hexToBytes, parseDisclosureReceipt } from '@midnight-demo/shared';
import { conditionScoreCommitment } from '@midnight-demo/shared/commitment';

loadEnv({ path: developmentEnvPath, quiet: true });
loadEnv({ path: path.join(repoRoot, '.env.local'), quiet: true });

type Command = 'deploy' | 'submit' | 'status' | 'fund' | 'wallet' | 'funding' | 'reconcile' | 'verify-receipt';

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0) return process.argv[index + 1];
  const inline = process.argv.find((argument) => argument.startsWith(`--${name}=`));
  return inline?.slice(name.length + 3);
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function networkFromArgs(): NetworkConfig {
  return resolveNetwork(flag('network'));
}

async function connectWallet(network: NetworkConfig): Promise<WalletContext> {
  const credentials = getOrCreateWalletCredentials();
  if (credentials.created && credentials.mnemonic) {
    process.stdout.write(`New operating wallet recovery phrase:\n${credentials.mnemonic}\n`);
    process.stdout.write(
      `Back up ${path.basename(developmentEnvPath)} securely; it is the operating wallet recovery source.\n`,
    );
  }
  process.stdout.write(`Syncing operating wallet with Midnight ${network.networkId}...\n`);
  const wallet = await createWallet(network.networkId, network, credentials.seed);
  process.stdout.write(`Wallet: ${walletAddress(wallet)}\n`);
  const state = await syncWallet(wallet, network.networkId);
  const balances = walletBalances(state);
  process.stdout.write(`raw tNIGHT: ${balances.night}  raw DUST: ${balances.dust}\n`);
  return wallet;
}

async function closeWallet(wallet: WalletContext, network: NetworkConfig): Promise<void> {
  wallet.checkpoint?.unsubscribe();
  await persistWalletState(wallet, network.networkId);
  await wallet.wallet.stop();
}

async function runDeploy(network: NetworkConfig): Promise<string> {
  const wallet = await connectWallet(network);
  try {
    await ensureDust(wallet, network.faucet);
    const contractAddress = await deployConditionRegistry(wallet, network);
    saveDeployment(network.networkId, {
      contractAddress,
      deployerAddress: walletAddress(wallet),
      deployedAt: new Date().toISOString(),
    });
    return contractAddress;
  } finally {
    await closeWallet(wallet, network);
  }
}

async function runSubmit(network: NetworkConfig): Promise<void> {
  const db = await openIngesterDb();
  const inputs = await loadAndPlan(db);
  process.stdout.write(`${summarize(inputs)}\n`);
  if (inputs.plan.planned.length === 0) {
    process.stdout.write('\nnothing to submit\n');
    return;
  }
  if (hasFlag('dry-run')) {
    process.stdout.write('\n--dry-run: not submitting\n');
    return;
  }

  const contractAddress = conditionContractAddress(
    flag('contract') ?? loadDeployment(network.networkId)?.contractAddress,
  );
  const wallet = await connectWallet(network);
  try {
    await ensureDust(wallet, network.faucet);
    let submitted = 0;
    for (const planned of inputs.plan.planned) {
      process.stdout.write(
        `submitting ${planned.ringId} ${new Date(planned.periodStartMs).toISOString()} (${planned.band}) ...\n`,
      );
      const tx = await submitCondition(wallet, network, contractAddress, planned);
      await recordSubmissions(db, [submissionRecord(planned, tx, planned.band, new Date().toISOString())]);
      submitted += 1;
      process.stdout.write(`  tx ${tx.txId} block ${tx.blockHeight}\n`);
    }
    process.stdout.write(`\nsubmitted ${submitted} entr${submitted === 1 ? 'y' : 'ies'} on-chain\n`);

    const entryKeys = inputs.plan.planned.map((planned) => planned.entryKey);
    process.stdout.write('confirming the submissions records against the chain ...\n');
    printReconcile(
      await reconcileSubmissions(db, conditionChain(network, contractAddress), { entryKeys }),
    );
  } finally {
    await closeWallet(wallet, network);
  }
}

function printReconcile(r: ReconcileResult): void {
  process.stdout.write(
    `  confirmed ${r.confirmed}  mismatches ${r.mismatches.length}  ` +
      `value-mismatches ${r.valueMismatches.length}  missing ${r.missing.length}\n`,
  );
  for (const m of r.mismatches) {
    process.stdout.write(`  ! mismatch ${m.entryKey.slice(0, 12)}… db=${m.dbBand} chain=${m.chainBand}\n`);
  }
  for (const m of r.valueMismatches) {
    process.stdout.write(
      `  ! value mismatch ${m.entryKey.slice(0, 12)}… value=${m.value} (${m.valueBand}) chain=${m.chainBand}\n`,
    );
  }
  for (const k of r.missing) process.stdout.write(`  … not on chain yet: ${k.slice(0, 12)}…\n`);
}

async function runReconcile(network: NetworkConfig): Promise<void> {
  const db = await openIngesterDb();
  const contractAddress = conditionContractAddress(
    flag('contract') ?? loadDeployment(network.networkId)?.contractAddress,
  );
  printReconcile(await reconcileSubmissions(db, conditionChain(network, contractAddress)));
}

async function runStatus(network: NetworkConfig): Promise<void> {
  const contractAddress = conditionContractAddress(
    flag('contract') ?? loadDeployment(network.networkId)?.contractAddress,
  );
  const status = await queryConditionRegistry(network, contractAddress);
  process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
}

async function runVerifyReceipt(network: NetworkConfig): Promise<void> {
  const file = process.argv[3];
  if (!file || file.startsWith('--')) throw new Error('usage: cli.ts verify-receipt <receipt.json> [--network preprod]');
  const receipt = parseDisclosureReceipt(JSON.parse(fs.readFileSync(file, 'utf8')));
  if (!receipt) throw new Error(`${file} is not a disclosure receipt`);
  const contractAddress = conditionContractAddress(
    flag('contract') ?? loadDeployment(network.networkId)?.contractAddress,
  );
  const entry = (await readConditionEntries(network, contractAddress, [receipt.entryKey])).get(receipt.entryKey);
  if (!entry) throw new Error(`the chain has no entry ${receipt.entryKey}`);
  const computed = bytesToHex(conditionScoreCommitment(receipt.scoreCenti, hexToBytes(receipt.nonceHex)));
  const matches = computed === entry.scoreCommitmentHex;
  process.stdout.write(
    matches
      ? `match: ${(receipt.scoreCenti / 100).toFixed(2)} is the ${entry.band}-band entry of ${receipt.periodDate} (commitment ${computed})
`
      : `MISMATCH: persistentCommit(${receipt.scoreCenti}, nonce) = ${computed}, chain has ${entry.scoreCommitmentHex}
`,
  );
  if (!matches) process.exitCode = 2;
}

async function runFund(network: NetworkConfig): Promise<void> {
  const credentials = getOrCreateWalletCredentials();
  const wallet = await createWallet(network.networkId, network, credentials.seed);
  const address = walletAddress(wallet);
  await closeWallet(wallet, network);
  const txId = await fundFromGenesis(network, address);
  process.stdout.write(`funded ${address} (tx ${txId}); re-run \`npm run condition:deploy\`\n`);
}

async function runWallet(network: NetworkConfig): Promise<void> {
  const wallet = await connectWallet(network);
  await closeWallet(wallet, network);
}

async function runFunding(network: NetworkConfig): Promise<void> {
  const credentials = getOrCreateWalletCredentials();
  const wallet = await createWallet(network.networkId, network, credentials.seed);
  try {
    const address = walletAddress(wallet);
    if (network.faucet) {
      process.stdout.write(`Fund ${address}\n  faucet: ${network.faucet}\nWatching for tNIGHT...\n`);
    } else {
      process.stdout.write(`Local devnet: run \`npm run condition:fund\` to fund ${address} from the genesis seed.\nWatching for tNIGHT...\n`);
    }
    const balance = await waitForNightBalance(wallet);
    process.stdout.write(`tNIGHT received: raw ${balance}\n`);
  } finally {
    await closeWallet(wallet, network);
  }
}

async function main(): Promise<void> {
  const command = process.argv[2] as Command | undefined;
  const network = networkFromArgs();

  if (command === 'deploy') {
    const address = await runDeploy(network);
    process.stdout.write(`\nconditionRegistry deployed: ${address}\n`);
    process.stdout.write(
      `set in ${path.basename(developmentEnvPath)}:  CONDITION_REGISTRY_CONTRACT_ADDRESS=${address}\n`,
    );
    return;
  }
  if (command === 'submit') return runSubmit(network);
  if (command === 'reconcile') return runReconcile(network);
  if (command === 'status') return runStatus(network);
  if (command === 'verify-receipt') return runVerifyReceipt(network);
  if (command === 'fund') return runFund(network);
  if (command === 'wallet') return runWallet(network);
  if (command === 'funding') return runFunding(network);

  process.stdout.write(
    'Usage: cli.ts <deploy|submit|reconcile|status|verify-receipt|fund|wallet|funding> [--network local] [--contract <addr>] [--dry-run]\n',
  );
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
