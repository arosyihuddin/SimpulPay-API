# Runtime: prod deps saja
FROM oven/bun:1.3-alpine
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY src ./src

ENV PORT=3000
EXPOSE 3000

CMD ["bun", "run", "src/main.ts"]
