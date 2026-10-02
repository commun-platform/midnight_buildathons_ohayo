import { handleApi } from '@midnight-demo/gateway';
import { saltFromHex } from '@midnight-demo/gateway/deps';
import { securityHeaders } from '@midnight-demo/gateway/security';
import { d1Database } from '@midnight-demo/db/d1';
import { drainQueue } from '@midnight-demo/ingester/queue';

import { runnerFetch } from './containers.js';
import { containerRunner, gatewayDeps, workerVars } from './deps.js';
import type { Env } from './env.js';

export { ContainerProxy } from '@cloudflare/containers';
export { ChainRunnerContainer, ProofServerContainer } from './containers.js';

function tooManyRequests(): Response {
  return new Response(JSON.stringify({ error: 'Too many login attempts - wait a minute' }), {
    status: 429,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'retry-after': '60' },
  });
}

function withHeaders(response: Response, headers: Record<string, string>): Response {
  const merged = new Headers(response.headers);
  for (const [name, value] of Object.entries(headers)) merged.set(name, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers: merged });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith('/api/auth/') && env.AUTH_RATE_LIMITER) {
      const key = request.headers.get('cf-connecting-ip') ?? 'unknown';
      if (!(await env.AUTH_RATE_LIMITER.limit({ key })).success) return tooManyRequests();
    }
    const deps = gatewayDeps(env, containerRunner(runnerFetch(env)));
    const api = await handleApi(request, deps);
    if (api) return api;
    return withHeaders(await env.ASSETS.fetch(request), securityHeaders(deps.config?.partnerUrl));
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const db = d1Database(env.DB);
    const salt = saltFromHex(workerVars(env).INGESTER_SALT_HEX);
    ctx.waitUntil(
      drainQueue(db, containerRunner(runnerFetch(env)), salt).then(
        (result) => {
          if (result.action !== 'idle') console.log(JSON.stringify({ message: 'chain_queue', ...result }));
        },
        (error: unknown) => {
          console.error(
            JSON.stringify({ message: 'chain_queue_failed', error: error instanceof Error ? error.message : String(error) }),
          );
        },
      ),
    );
  },
} satisfies ExportedHandler<Env>;
