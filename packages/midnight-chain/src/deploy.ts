import {
  CONDITION_PRIVATE_STATE_ID,
  createConditionPrivateState,
} from '@midnight-demo/condition-registry-contract/witnesses';
import { deployContract } from '@midnight-ntwrk/midnight-js-contracts';

import type { NetworkConfig } from './config.js';
import { loadCompiledContract } from './contract.js';
import { createProviders, waitForProofServer } from './providers.js';
import { getOrCreateWalletCredentials, submitterSecretKeyHex } from './state.js';
import type { WalletContext } from './wallet.js';

export async function deployConditionRegistry(
  wallet: WalletContext,
  network: NetworkConfig,
): Promise<string> {
  const loaded = await loadCompiledContract();
  const providers = createProviders(wallet, network);
  await waitForProofServer(network);
  const deployed = await deployContract(providers as never, {
    compiledContract: loaded.compiledContract as never,
    args: [],
    privateStateId: CONDITION_PRIVATE_STATE_ID,
    initialPrivateState: createConditionPrivateState(
      submitterSecretKeyHex(getOrCreateWalletCredentials().seed),
    ),
  });
  return deployed.deployTxData.public.contractAddress;
}
