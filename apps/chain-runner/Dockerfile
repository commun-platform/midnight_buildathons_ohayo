FROM node:22.15.0-bookworm-slim

WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY packages/condition-read ./packages/condition-read
COPY packages/ingester-core ./packages/ingester-core
COPY packages/midnight-chain ./packages/midnight-chain
COPY contracts/condition-registry ./contracts/condition-registry
COPY apps/chain-runner ./apps/chain-runner

RUN npm ci --omit=dev --no-audit --no-fund \
      --workspace @midnight-demo/chain-runner \
      --include-workspace-root=true

ENV NODE_ENV=production
ENV CONTRACT_DIR=/app/contracts/condition-registry/src/managed/condition-registry
RUN test -f "$CONTRACT_DIR/contract/index.js" \
    && test -f "$CONTRACT_DIR/keys/submitCondition.prover" \
    && test -f "$CONTRACT_DIR/keys/submitCondition.verifier" \
    && test -f "$CONTRACT_DIR/zkir/submitCondition.bzkir"
RUN useradd --system --uid 10001 runner && mkdir -p /app/.state && chown runner /app /app/.state
USER runner

EXPOSE 8080
CMD ["node", "--import", "tsx", "apps/chain-runner/src/server.ts"]
