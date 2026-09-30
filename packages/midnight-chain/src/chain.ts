import type { ConditionChain } from '@midnight-demo/ingester-core';

import type { NetworkConfig } from './config.js';
import { readConditionEntries } from './reader.js';
import { submitReadings } from './staged.js';

export function conditionChain(network: NetworkConfig, contractAddress: string): ConditionChain {
  return {
    submitReadings: (request) => submitReadings(network, contractAddress, request),
    readEntries: (entryKeys) => readConditionEntries(network, contractAddress, entryKeys),
  };
}
