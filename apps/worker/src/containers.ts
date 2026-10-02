import { Container, getContainer } from '@cloudflare/containers';

import { handleCheckpoint } from './checkpoint-store.js';
import type { Env } from './env.js';

export const RUNNER_INSTANCE = 'chain-runner';
export const PROOF_INSTANCE = 'proof-server';

const RUNNER_PORT = 8080;
const PROOF_PORT = 6300;

class RuntimeContainer extends Container<Env> {
  protected async needsStart(): Promise<boolean> {
    if (!this.ctx.container?.running) return true;
    return (await this.getState()).status !== 'healthy';
  }

  override onStart(): void {
    console.log(JSON.stringify({ message: 'container_started', container: this.constructor.name }));
  }

  override onStop({ exitCode, reason }: { exitCode: number; reason: string }): void {
    console.log(JSON.stringify({ message: 'container_stopped', container: this.constructor.name, exitCode, reason }));
  }

  override onError(error: unknown): void {
    console.error(
      JSON.stringify({
        message: 'container_error',
        container: this.constructor.name,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

export class ProofServerContainer extends RuntimeContainer {
  defaultPort = PROOF_PORT;
  requiredPorts = [PROOF_PORT];
  sleepAfter = '3m';
  enableInternet = false;
  interceptHttps = true;
  allowedHosts = ['srs.midnight.network'];
  envVars = { SSL_CERT_FILE: '/etc/cloudflare/certs/cloudflare-containers-ca.crt' };
  entrypoint = ['midnight-proof-server', '--port', String(PROOF_PORT)];

  override async fetch(request: Request): Promise<Response> {
    if (await this.needsStart()) {
      await this.startAndWaitForPorts({
        ports: PROOF_PORT,
        cancellationOptions: { instanceGetTimeoutMS: 60_000, portReadyTimeoutMS: 15 * 60_000, waitInterval: 1_000 },
      });
    }
    return this.containerFetch(request, PROOF_PORT);
  }
}

export class ChainRunnerContainer extends RuntimeContainer {
  defaultPort = RUNNER_PORT;
  requiredPorts = [RUNNER_PORT];
  sleepAfter = '5m';
  enableInternet = true;
  interceptHttps = false;
  allowedHosts = [
    'proof.internal',
    'state.internal',
    'indexer.preprod.midnight.network',
    'rpc.preprod.midnight.network',
  ];
  pingEndpoint = 'chain-runner/health';

  private runtimeEnv(): Record<string, string> {
    const required = (name: string, value: string | undefined): string => {
      const trimmed = value?.trim();
      if (!trimmed) throw new Error(`${name} is not configured`);
      return trimmed;
    };
    return {
      NODE_ENV: 'production',
      PORT: String(RUNNER_PORT),
      MIDNIGHT_NETWORK: required('MIDNIGHT_NETWORK', this.env.MIDNIGHT_NETWORK),
      CONDITION_REGISTRY_CONTRACT_ADDRESS: required(
        'CONDITION_REGISTRY_CONTRACT_ADDRESS',
        this.env.CONDITION_REGISTRY_CONTRACT_ADDRESS,
      ),
      DEVELOPMENT_WALLET_MNEMONIC: required('OPERATING_WALLET_MNEMONIC', this.env.OPERATING_WALLET_MNEMONIC),
      DEVELOPMENT_PRIVATE_STATE_PASSWORD: required(
        'DEVELOPMENT_PRIVATE_STATE_PASSWORD',
        this.env.DEVELOPMENT_PRIVATE_STATE_PASSWORD,
      ),
      MIDNIGHT_PROOF_SERVER_URL: 'http://proof.internal',
      WALLET_CHECKPOINT_URL: 'http://state.internal/checkpoint',
    };
  }

  override async fetch(request: Request): Promise<Response> {
    if (await this.needsStart()) {
      await this.startAndWaitForPorts({
        startOptions: { envVars: this.runtimeEnv(), enableInternet: true },
        ports: RUNNER_PORT,
        cancellationOptions: { instanceGetTimeoutMS: 60_000, portReadyTimeoutMS: 5 * 60_000, waitInterval: 500 },
      });
    }
    return this.containerFetch(request, RUNNER_PORT);
  }
}

ChainRunnerContainer.outboundByHost = {
  'proof.internal': (request: Request, env: Env) =>
    getContainer(env.PROOF_SERVER, PROOF_INSTANCE).fetch(new Request(request.url.replace('proof.internal', 'proof-server'), request)),
  'state.internal': (request: Request, env: Env) =>
    handleCheckpoint(request, env.WALLET_STATE, env.MIDNIGHT_NETWORK ?? 'preprod'),
};

export function runnerFetch(env: Env): (request: Request) => Promise<Response> {
  return (request) => getContainer(env.CHAIN_RUNNER, RUNNER_INSTANCE).fetch(request);
}
