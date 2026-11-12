# Build context must be the repo root (npm workspaces: orquestador + robot)
# docker compose in this folder is already configured with the right context.

FROM node:26-alpine AS base
WORKDIR /app

# ---- deps: install only what "orquestador" needs, without running postinstall yet ----
FROM base AS deps
COPY package.json package-lock.json ./
COPY orquestador/package.json orquestador/package.json
COPY robot/package.json robot/package.json
RUN npm ci --workspace=orquestador --include-workspace-root --ignore-scripts

# ---- build: bring in full source and produce the Nuxt server build ----
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY orquestador orquestador
COPY robot/package.json robot/package.json
RUN npm run postinstall --workspace=orquestador
RUN npm run build --workspace=orquestador

# ---- runtime: minimal image with only the compiled Nitro server ----
FROM node:26-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV NITRO_PORT=3000
ENV NITRO_HOST=0.0.0.0
COPY --from=build /app/orquestador/.output ./.output
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
