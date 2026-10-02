import { d1Database, type D1DatabaseLike } from '@midnight-demo/db/d1';

import { handlePartner, type PartnerDeps } from './handler.js';
import { partnerSigner } from './signing.js';

export interface PartnerEnv {
  DB: D1DatabaseLike;
  PARTNER_API_KEY?: string;
  PARTNER_SIGNING_KEY?: string;
  PARTNER_ALLOWED_ORIGIN?: string;
}

let deps: Promise<PartnerDeps> | null = null;

async function makeDeps(env: PartnerEnv): Promise<PartnerDeps> {
  const apiKey = env.PARTNER_API_KEY?.trim();
  const signingKey = env.PARTNER_SIGNING_KEY?.trim();
  if (!apiKey || !signingKey) throw new Error('PARTNER_API_KEY and PARTNER_SIGNING_KEY are required');
  return {
    db: d1Database(env.DB),
    apiKey,
    signer: await partnerSigner(signingKey),
    ...(env.PARTNER_ALLOWED_ORIGIN?.trim() ? { allowedOrigin: env.PARTNER_ALLOWED_ORIGIN.trim() } : {}),
  };
}

export default {
  async fetch(request: Request, env: PartnerEnv): Promise<Response> {
    deps ??= makeDeps(env).catch((error: unknown) => {
      deps = null;
      throw error;
    });
    return handlePartner(request, await deps);
  },
};
