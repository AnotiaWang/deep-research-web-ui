FROM node:20-alpine AS deps

WORKDIR /app

# 只复制依赖相关文件
COPY package.json pnpm-lock.yaml ./
RUN npm i -g --force pnpm@9
RUN pnpm install --frozen-lockfile --prod

FROM node:20-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NODE_OPTIONS="--max_old_space_size=2048"
RUN npm i -g --force pnpm@9
RUN pnpm install --frozen-lockfile
RUN pnpm build:optimize

FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

# 只复制必要的文件
COPY --from=builder /app/.output .output
COPY --from=builder /app/package.json .

EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
