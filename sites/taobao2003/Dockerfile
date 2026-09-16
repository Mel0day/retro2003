# ---- 依赖层 ----
# better-sqlite3 优先下载预编译包；下载失败时才安装编译工具从源码编译。
# 国内服务器可以加 --build-arg NPM_REGISTRY=https://registry.npmmirror.com
FROM node:24-bookworm-slim AS deps
ARG NPM_REGISTRY=https://registry.npmjs.org
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm config set registry "$NPM_REGISTRY" \
    && (npm ci --omit=dev \
        || (apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
            && rm -rf /var/lib/apt/lists/* && npm ci --omit=dev --build-from-source)) \
    && npm cache clean --force

# ---- 运行层 ----
FROM node:24-bookworm-slim
ENV NODE_ENV=production \
    PORT=3004 \
    HOST=0.0.0.0 \
    DATA_DIR=/data \
    TZ=Asia/Shanghai
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
EXPOSE 3004
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3004)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/server.js"]
