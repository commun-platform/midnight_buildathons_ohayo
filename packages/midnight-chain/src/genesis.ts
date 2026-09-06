import * as Rx from 'rxjs';

import { unshieldedToken } from '@midnight-ntwrk/midnight-js-protocol/ledger';
import { getNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { MidnightBech32m, UnshieldedAddress } from '@midnight-ntwrk/wallet-sdk';

import { genesisSeed, type NetworkConfig } from './config.js';
import {
  createWallet,
  ensureDust,
  persistWalletState,
  syncWallet,
  walletAddress,
  walletBalances,
} from './wallet.js';

export async function fundFromGenesis(
  network: NetworkConfig,
  recipientAddress: string,
  amountNight = 200_000_000_000n,
): Promise<string> {
  if (network.networkId !== 'local') {
    throw new Error('fundFromGenesis is only for MIDNIGHT_NETWORK=local; use the public faucet otherwise');
  }
  const genesis = await createWallet(network.networkId, network, genesisSeed());
  try {
    process.stdout.write(`Genesis wallet: ${walletAddress(genesis)}\n`);
    await syncWallet(genesis, network.networkId);
    const synced = await genesis.wallet.waitForSyncedState();
    const balance = walletBalances(synced);
    if (balance.night < amountNight) {
      throw new Error(
        `Genesis wallet holds ${balance.night} raw NIGHT, need ${amountNight}. ` +
          'The genesis allocation is spent once per devnet — recreate the chain with `run.sh down` then `run.sh e2e`.',
      );
    }

    await ensureDust(genesis, '');
    await Rx.firstValueFrom(
      genesis.wallet.state().pipe(
        Rx.filter((next) => next.unshielded.progress.isStrictlyComplete()),
        Rx.timeout({ first: 120_000 }),
      ),
    );

    const receiver = MidnightBech32m.parse(recipientAddress).decode(UnshieldedAddress, getNetworkId());
    const w = genesis.wallet;
    const recipe = await w.transferTransaction(
      [
        {
          type: 'unshielded',
          outputs: [{ type: unshieldedToken().raw, receiverAddress: receiver, amount: amountNight }],
        },
      ],
      { shieldedSecretKeys: genesis.shieldedSecretKeys, dustSecretKey: genesis.dustSecretKey },
      { ttl: new Date(Date.now() + 30 * 60 * 1000), payFees: true },
    );
    const signed = await w.signRecipe(recipe, (data) => genesis.unshieldedKeystore.signData(data));
    const txId = await w.submitTransaction(await w.finalizeRecipe(signed));
    process.stdout.write(`Funding tx submitted: ${txId}\n`);

    await Rx.firstValueFrom(
      genesis.wallet.state().pipe(
        Rx.filter((next) => next.unshielded.progress.isStrictlyComplete()),
        Rx.timeout({ first: 120_000 }),
      ),
    );
    return String(txId);
  } finally {
    genesis.checkpoint?.unsubscribe();
    await persistWalletState(genesis, network.networkId);
    await genesis.wallet.stop();
  }
}
