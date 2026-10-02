FROM node:22-alpine AS builder
WORKDIR /app

RUN npm i -g --force pnpm@9

# 先只复制依赖清单：依赖未变化时可以复用安装层缓存。
# 此时还没有源码，跳过 postinstall（nuxt prepare），nuxt build 会自行完成。
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts

COPY . .

ENV NODE_OPTIONS="--max_old_space_size=2048"
RUN pnpm build:optimize

FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

# .output 已包含运行所需的全部依赖
COPY --from=builder /app/.output .output

# 以非 root 用户运行；.cache 用于保存 API key 轮询状态，需要可写
RUN mkdir -p .cache && chown node:node .cache
USER node

EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
