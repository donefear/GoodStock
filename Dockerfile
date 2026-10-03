FROM node:22-alpine
ENV NODE_ENV=production PORT=8080 DATA_DIR=/data
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY fonts/*.woff2 fonts/fonts.css ./fonts/
COPY lang/*.js ./lang/
COPY server.mjs index.html i18n.js icon.svg app.js kitchen-tools.js kitchen-reference.js recipe-import.mjs mealie.mjs deepl.mjs styles.css sw.js manifest.webmanifest ingredients.json ./
RUN mkdir -p /data && chown -R node:node /app /data
USER node
EXPOSE 8080
VOLUME ["/data"]
CMD ["node", "server.mjs"]