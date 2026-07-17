FROM node:26-alpine
WORKDIR /app
COPY package*.json ./
RUN apk add --no-cache --virtual .build python3 make g++ \
 && npm install --production \
 && apk del .build \
 # npm's own bundled undici (CVE-2026-12151) ships in the base image and is
 # unused at runtime (container only runs `node server.js`); remove it so it
 # can't trip image scanners.
 && rm -rf /usr/local/lib/node_modules/npm/node_modules/undici
COPY . .
EXPOSE 8001
ENV NEW_RELIC_DISTRIBUTED_TRACING_ENABLED=true
ENV NEW_RELIC_LOG=stdout
ENV NEW_RELIC_NO_CONFIG_FILE=true
ENV UV_THREADPOOL_SIZE=16
ENV BCRYPT_COST=8
CMD ["node", "server.js"]


