FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# The server needs only Node and the `ws` package.
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    STATIC_DIR=/app/dist \
    DATA_DIR=/data
COPY --from=build /app/node_modules/ws ./node_modules/ws
COPY --from=build /app/dist ./dist
COPY server/server.mjs ./server/server.mjs
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8080
CMD ["node", "server/server.mjs"]
