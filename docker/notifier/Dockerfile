# syntax=docker/dockerfile:1.7
FROM node:20-alpine

WORKDIR /app
ENV NPM_CONFIG_AUDIT=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_FETCH_RETRIES=5 \
    NPM_CONFIG_FETCH_RETRY_FACTOR=2 \
    NPM_CONFIG_FETCH_RETRY_MINTIMEOUT=20000 \
    NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT=120000 \
    NPM_CONFIG_FETCH_TIMEOUT=180000

# ffmpeg converts the WAV voicemail to MP3 before it is attached to the mail.
RUN apk add --no-cache ffmpeg

COPY package.json ./package.json
COPY package-lock.json ./package-lock.json
COPY notifier/package.json ./notifier/package.json

RUN --mount=type=cache,target=/root/.npm npm ci --workspace notifier --prefer-offline --no-audit --no-fund

COPY notifier ./notifier

WORKDIR /app/notifier

RUN npm run build

USER node

CMD ["node", "dist/index.js"]
