FROM node:26-alpine
WORKDIR /app
COPY package*.json ./
RUN apk add --no-cache --virtual .build python3 make g++ \
 && npm install --production \
 && apk del .build
COPY . .
EXPOSE 8001
CMD ["node", "server.js"]
ENV NEW_RELIC_DISTRIBUTED_TRACING_ENABLED=true
ENV NEW_RELIC_LOG=stdout
ENV NEW_RELIC_NO_CONFIG_FILE=true


