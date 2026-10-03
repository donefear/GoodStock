FROM node:22-alpine
ENV NODE_ENV=production PORT=8080 DATA_DIR=/data
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY fonts/*.woff2 fonts/fonts.css ./fonts/
COPY lang/*.js ./lang/
COPY app/*.js ./app/
COPY server.mjs index.html i18n.js icon.svg apple-touch-icon.png icon-192.png icon-512.png kitchen-tools.js kitchen-reference.js recipe-import.mjs mealie.mjs deepl.mjs styles.css sw.js manifest.webmanifest ingredients.json ./
RUN mkdir -p /data && chown -R node:node /app /data
USER node
EXPOSE 8080
# Portainer and `docker ps` show the container as healthy or unhealthy. /api/health stays open even with a household PIN.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT:-8080}/api/health" || exit 1
VOLUME ["/data"]
CMD ["node", "server.mjs"]