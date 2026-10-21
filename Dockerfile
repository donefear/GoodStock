# The copy of the app for old browsers (tools/build-legacy.mjs), built with the dev dependencies in a stage of its own
# so they stay out of the image.
FROM node:22-alpine AS legacy
WORKDIR /build
COPY package.json ./
RUN PUPPETEER_SKIP_DOWNLOAD=true npm install --no-audit --no-fund
COPY index.html styles.css i18n.js kitchen-tools.js kitchen-reference.js recipe-import.mjs mealie.mjs deepl.mjs ./
COPY app ./app
COPY lang ./lang
COPY fonts ./fonts
COPY tools ./tools
RUN node tools/build-legacy.mjs

FROM node:22-alpine
ENV NODE_ENV=production PORT=8080 DATA_DIR=/data
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY fonts/*.woff2 fonts/fonts.css ./fonts/
COPY fonts/legacy/*.woff fonts/legacy/fonts.css ./fonts/legacy/
COPY lang/*.js ./lang/
COPY app/*.js ./app/
COPY server.mjs index.html i18n.js icon.svg apple-touch-icon.png icon-192.png icon-512.png kitchen-tools.js kitchen-reference.js recipe-import.mjs mealie.mjs deepl.mjs styles.css sw.js manifest.webmanifest ingredients.json ./
COPY --from=legacy /build/legacy ./legacy
RUN mkdir -p /data && chown -R node:node /app /data
USER node
EXPOSE 8080
# Portainer and `docker ps` show the container as healthy or unhealthy. /api/health stays open even with a household PIN.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT:-8080}/api/health" || exit 1
VOLUME ["/data"]
CMD ["node", "server.mjs"]
