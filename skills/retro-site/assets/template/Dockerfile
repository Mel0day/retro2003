# ---- 依赖层 ----
FROM node:24-bookworm-slim AS deps
ARG NPM_REGISTRY=https://registry.npmjs.org
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm config set registry "$NPM_REGISTRY" \
    && (npm ci --omit=dev 2>/dev/null || npm install --omit=dev \
        || (apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
            && rm -rf /var/lib/apt/lists/* && npm install --omit=dev --build-from-source)) \
    && npm cache clean --force

# ---- 运行层 ----
FROM node:24-bookworm-slim
ENV NODE_ENV=production PORT=__PORT__ HOST=0.0.0.0 DATA_DIR=/data TZ=Asia/Shanghai
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY views ./views
COPY public ./public
COPY scripts ./scripts
COPY seed ./seed
RUN mkdir -p /data && chown -R node:node /data
USER node
EXPOSE __PORT__
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||__PORT__)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/server.js"]
