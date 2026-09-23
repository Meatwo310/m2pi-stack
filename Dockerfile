FROM node:24-bookworm-slim AS build
WORKDIR /opt/m2pi
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json ./
COPY src ./src
COPY config ./config
COPY plugins ./plugins
RUN pnpm build && pnpm prune --prod

FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    HOME=/data/home \
    PI_CODING_AGENT_DIR=/data/pi/agent \
    PI_CODING_AGENT_SESSION_DIR=/data/pi/sessions \
    M2PI_DB_PATH=/data/app.db \
    M2PI_WORKSPACE=/workspace
WORKDIR /opt/m2pi
COPY --from=build /opt/m2pi/package.json ./
COPY --from=build /opt/m2pi/node_modules ./node_modules
COPY --from=build /opt/m2pi/dist ./dist
COPY --from=build /opt/m2pi/config ./config
COPY --from=build /opt/m2pi/plugins ./plugins
RUN mkdir -p /data/home /data/pi/agent /data/pi/sessions /workspace && chown -R node:node /data /workspace
USER node
CMD ["node", "dist/main.js"]
