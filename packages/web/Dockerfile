FROM node:24-slim AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN corepack enable && corepack prepare pnpm@11.5.3 --activate

WORKDIR /app

FROM base AS builder

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY vendor ./vendor
COPY packages/api/package.json ./packages/api/package.json
COPY packages/common/package.json ./packages/common/package.json
COPY packages/mobile/package.json ./packages/mobile/package.json
COPY packages/web/package.json ./packages/web/package.json

RUN pnpm install --frozen-lockfile

COPY . .

# `next build` inlines every NEXT_PUBLIC_* into the client bundle, so they have to exist here.
# A host's environment tab only reaches the running container: a value set there alone never
# leaves the server side, and the browser gets an empty string (Stripe reads as unconfigured).
ARG NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=""
ARG NEXT_PUBLIC_PLAN_BASIC_PRICE_CENTS=""
ARG NEXT_PUBLIC_OPERATOR_CONTACT=""

ENV NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY="$NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY"
ENV NEXT_PUBLIC_PLAN_BASIC_PRICE_CENTS="$NEXT_PUBLIC_PLAN_BASIC_PRICE_CENTS"
ENV NEXT_PUBLIC_OPERATOR_CONTACT="$NEXT_PUBLIC_OPERATOR_CONTACT"

RUN pnpm --filter @receivy/web build

FROM node:24-slim AS runner

ENV NODE_ENV="production"
ENV PORT="3000"
ENV HOSTNAME="0.0.0.0"

RUN groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs nextjs

WORKDIR /app

COPY --from=builder --chown=nextjs:nodejs /app/packages/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/packages/web/.next/static ./packages/web/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/packages/web/public ./packages/web/public

USER nextjs

EXPOSE 3000

CMD ["node", "packages/web/server.js"]
