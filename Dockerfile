ARG NODE_VERSION=24.21.0
FROM node:${NODE_VERSION}-slim AS base

WORKDIR /app

# --- Stage to build the app ---
FROM base AS build

# better-sqlite3 has no prebuilt binary for this Node version, so compile it
RUN apt-get update -y && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm@12.6.0
COPY --link package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY --link . .
ARG VERSION_SUFFIX=""
RUN pnpm build

FROM base AS runtime

# better-sqlite3 has no prebuilt binary for this Node version, so compile it
RUN apt-get update -y && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm@12.6.0
COPY --link package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod

# --- Stage to release the app ---
FROM base AS release

ENV NODE_ENV=production

RUN apt-get update -y && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

COPY --from=runtime /app/node_modules /app/node_modules
COPY --from=build /app/package.json /app/package.json
COPY --from=build /app/server/database/migrations /app/server/database/migrations
COPY --from=build /app/run.sh /app/run.sh
COPY --from=build /app/.output /app/.output

ENV DATABASE_URL="file:/app/data/db.sqlite"

CMD [ "bash", "/app/run.sh" ]
HEALTHCHECK --interval=30s --timeout=30s --start-period=5s --retries=3 CMD curl --fail http://localhost:3000/health || exit 1
