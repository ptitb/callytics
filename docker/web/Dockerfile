# syntax=docker/dockerfile:1.7
FROM node:20-bookworm-slim AS build

WORKDIR /app
ENV NPM_CONFIG_AUDIT=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_FETCH_RETRIES=5 \
    NPM_CONFIG_FETCH_RETRY_FACTOR=2 \
    NPM_CONFIG_FETCH_RETRY_MINTIMEOUT=20000 \
    NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT=120000 \
    NPM_CONFIG_FETCH_TIMEOUT=180000

COPY package.json ./package.json
COPY package-lock.json ./package-lock.json
COPY frontend/package.json ./frontend/package.json

RUN --mount=type=cache,target=/root/.npm npm ci --workspace frontend --prefer-offline --no-audit --no-fund

COPY frontend ./frontend

WORKDIR /app/frontend

RUN npm run build

FROM nginx:alpine

ENV UPLOAD_MAX_MB=100 \
    WEB_BIND_ADDR=127.0.0.1

# The nginx image renders /etc/nginx/templates/*.template with envsubst at start.
COPY docker/web/nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=build /app/frontend/dist /usr/share/nginx/html

EXPOSE 3000

CMD ["nginx", "-g", "daemon off;"]
