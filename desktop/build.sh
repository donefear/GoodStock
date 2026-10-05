#!/usr/bin/env bash
# Builds the Windows and Linux desktop apps inside Docker (with Wine for the .exe), so only Docker is needed here.
# Usage from the repository root (Linux or WSL):  bash desktop/build.sh
# The files land in dist/desktop/. The Mac app needs a Mac: GitHub builds it (.github/workflows/desktop.yml).
set -euo pipefail
cd "$(dirname "$0")/.."

docker run --rm \
  -v "$PWD":/project \
  -v goodstock-desktop-node-modules:/project/desktop/node_modules \
  -v goodstock-electron-cache:/root/.cache/electron \
  -v goodstock-electron-builder-cache:/root/.cache/electron-builder \
  -w /project/desktop \
  electronuserland/builder:wine \
  bash -c 'npm install --no-audit --no-fund --loglevel=error && VERSION=$(node prepare.mjs) \
    && npx electron-builder --win --linux --publish never -c.extraMetadata.version="$VERSION"'

ls -1 dist/desktop/*.exe dist/desktop/*.AppImage
