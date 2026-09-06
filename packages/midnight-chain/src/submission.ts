import { ApiPromise, WsProvider } from '@polkadot/api';
import { u8aToHex } from '@polkadot/util';

import type * as ledger from '@midnight-ntwrk/midnight-js-protocol/ledger';
import { SubmissionEvent } from '@midnight-ntwrk/wallet-sdk-node-client/effect';
import { Capabilities, SerializedTransaction as SerializedTx } from '@midnight-ntwrk/wallet-sdk';

type WaitFor = 'Submitted' | 'InBlock' | 'Finalized';

export async function createSubmissionService(
  relayUrl: string,
): Promise<Capabilities.SubmissionService<ledger.FinalizedTransaction>> {
  const api = await ApiPromise.create({
    provider: new WsProvider(relayUrl, 2_500),
    throwOnConnect: false,
    noInitWarn: true,
  });

  const submitTransaction = (
    tx: { serialize(): Uint8Array },
    waitForStatus: WaitFor = 'InBlock',
  ): Promise<SubmissionEvent.SubmissionEvent> => {
    const raw = tx.serialize();
    const serialized = SerializedTx.from(tx);
    const hex = u8aToHex(raw);
    return new Promise((resolve, reject) => {
      let unsubscribe: (() => void) | undefined;
      let settled = false;
      const finish = (run: () => void): void => {
        if (settled) return;
        settled = true;
        try {
          unsubscribe?.();
        } catch {
        }
        run();
      };

      void api.tx.midnight
        .sendMnTransaction(hex)
        .send((result) => {
          const status = result.status;
          const txHash = result.txHash.toString();
          const blockHeight = ((): bigint => {
            const value = (result as { blockNumber?: { toString(radix?: number): string } }).blockNumber;
            try {
              return value ? BigInt(value.toString(10)) : 0n;
            } catch {
              return 0n;
            }
          })();

          if (status.isInvalid) return finish(() => reject(new Error('Transaction rejected by the node as invalid')));
          if (status.isDropped) return finish(() => reject(new Error('Transaction dropped from the mempool')));
          if (status.isUsurped) return finish(() => reject(new Error('Transaction was usurped by another')));
          if (status.isFinalityTimeout) {
            return finish(() => reject(new Error('Transaction did not reach finality in time')));
          }

          const submittedish = status.isReady || status.isBroadcast || status.isFuture || status.isRetracted;
          if (submittedish && waitForStatus === 'Submitted') {
            return finish(() => resolve(SubmissionEvent.Submitted({ tx: serialized, txHash })));
          }
          if (status.isInBlock && waitForStatus !== 'Finalized') {
            return finish(() =>
              resolve(
                SubmissionEvent.InBlock({
                  tx: serialized,
                  blockHash: status.asInBlock.toString(),
                  blockHeight,
                  txHash,
                }),
              ),
            );
          }
          if (status.isFinalized) {
            return finish(() =>
              resolve(
                SubmissionEvent.Finalized({
                  tx: serialized,
                  blockHash: status.asFinalized.toString(),
                  blockHeight,
                  txHash,
                }),
              ),
            );
          }
        })
        .then((stop) => {
          unsubscribe = stop;
          if (settled) {
            try {
              stop();
            } catch {
            }
          }
        })
        .catch((error: unknown) =>
          finish(() => reject(error instanceof Error ? error : new Error(String(error)))),
        );
    });
  };

  return {
    submitTransaction,
    close: () => api.disconnect(),
  } as unknown as Capabilities.SubmissionService<ledger.FinalizedTransaction>;
}
