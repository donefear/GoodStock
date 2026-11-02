#!/usr/bin/env bash
# Builds the Windows and Linux desktop apps inside Docker (with Wine for the .exe), so only Docker is needed here.
# Usage from the repository root (Linux or WSL):  bash desktop/build.sh
# The files land in dist/desktop/. The Mac app needs a Mac: GitHub builds it (.github/workflows/desktop.yml).
set -euo pipefail
cd "$(dirname "$0")/.."

# The repository's own dev dependencies go into a volume of their own (so the build doesn't touch a node_modules
# made on this machine): prepare.mjs needs them to build legacy/, the copy for old browsers. CI=true makes it fail
# rather than ship without legacy/.
docker run --rm \
  -v "$PWD":/project \
  -v goodstock-desktop-root-node-modules:/project/node_modules \
  -v goodstock-desktop-node-modules:/project/desktop/node_modules \
  -v goodstock-desktop-npm-cache:/root/.npm \
  -v goodstock-electron-cache:/root/.cache/electron \
  -v goodstock-electron-builder-cache:/root/.cache/electron-builder \
  -e CI=true \
  -e PUPPETEER_SKIP_DOWNLOAD=true \
  -w /project/desktop \
  electronuserland/builder:wine \
  bash -c '(cd .. && npm install --no-audit --no-fund --loglevel=error) \
    && npm install --no-audit --no-fund --loglevel=error && VERSION=$(node prepare.mjs) \
    && npx electron-builder --win --linux --publish never -c.extraMetadata.version="$VERSION"'

ls -1 dist/desktop/*.exe dist/desktop/*.AppImage
