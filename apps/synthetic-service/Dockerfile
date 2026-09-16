# Multi-stage build for synthetic-service
FROM node:22-alpine AS builder

WORKDIR /app
COPY package*.json ./
COPY turbo.json ./
COPY tsconfig.base.json ./
COPY packages/reliability ./packages/reliability
COPY apps/synthetic-service ./apps/synthetic-service

RUN npm install
RUN npm --prefix packages/reliability run build
RUN npm --prefix apps/synthetic-service run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/reliability/dist ./packages/reliability/dist
COPY --from=builder /app/packages/reliability/package.json ./packages/reliability/package.json
COPY --from=builder /app/apps/synthetic-service/dist ./dist
COPY --from=builder /app/apps/synthetic-service/package.json ./package.json

EXPOSE 8080 8081

ENTRYPOINT ["node", "dist/index.js"]
