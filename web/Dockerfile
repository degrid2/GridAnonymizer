# Hosted page in a container. Build context: this folder.
#   docker build -t gridanon-web .
#   docker run -p 8080:8080 gridanon-web
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build:web

# The runtime has no node_modules: server.mjs has zero dependencies.
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production DIST_DIR=/app/dist
COPY --from=build /app/dist ./dist
COPY server.mjs ./server.mjs
EXPOSE 8080
USER node
CMD ["node", "server.mjs"]
