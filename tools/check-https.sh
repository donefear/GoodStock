#!/bin/bash
# Checks the optional HTTPS service (https/Caddyfile) with Docker: builds Goodstock and the Caddy image, starts them
# on their own network and ports (18443, 18485), and checks the plain-http redirect, the certificate download,
# HTTPS with that certificate for an IP address (no server name sent), and live events through the proxy.
# Leaves nothing running. Used by .github/workflows/tests.yml; run it locally with `bash tools/check-https.sh`.
cd "$(dirname "$0")/.."
failed=0
check() { if [ "$2" = "$3" ]; then echo "ok    $1"; else echo "FAIL  $1: got '$2', expected '$3'"; failed=1; fi; }
cleanup() { docker rm -f gs-check-app gs-check-https >/dev/null 2>&1; docker network rm gs-check >/dev/null 2>&1; rm -rf "${work:-}"; }
cleanup
work=$(mktemp -d)
trap cleanup EXIT

docker compose -f docker-compose.yml config -q && docker compose -f compose.yaml config -q || { echo "FAIL  compose files"; exit 1; }
cmp -s docker-compose.yml compose.yaml || { echo "FAIL  compose.yaml differs from docker-compose.yml"; failed=1; }
docker build -q -t goodstock-check-app . >/dev/null && docker build -q -t goodstock-check-https ./https >/dev/null || { echo "FAIL  image build"; exit 1; }
docker network create gs-check >/dev/null
docker run -d --name gs-check-app --network gs-check --network-alias goodstock goodstock-check-app >/dev/null
docker run -d --name gs-check-https --network gs-check -p 18443:443 -p 18485:80 \
  -e HTTPS_HOST=127.0.0.1 -e HTTPS_CERT=internal -e HTTPS_PORT=18443 goodstock-check-https >/dev/null
for _ in $(seq 1 30); do curl -sf -o /dev/null http://127.0.0.1:18485/goodstock-root.crt && break; sleep 1; done

check "plain http goes to HTTPS" "$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' http://127.0.0.1:18485/index.html)" "302 https://127.0.0.1:18443/index.html"
check "certificate download" "$(curl -s -o "$work/root.crt" -w '%{http_code} %{content_type}' http://127.0.0.1:18485/goodstock-root.crt)" "200 application/x-x509-ca-cert"
for _ in $(seq 1 20); do curl -sf --cacert "$work/root.crt" -o /dev/null https://127.0.0.1:18443/api/health && break; sleep 1; done
check "HTTPS with the certificate" "$(curl -s --cacert "$work/root.crt" https://127.0.0.1:18443/api/health)" '{"ok":true}'
check "the app over HTTPS" "$(curl -s --cacert "$work/root.crt" -o /dev/null -w '%{http_code}' https://127.0.0.1:18443/)" "200"
events=$(timeout 3 curl -s -N --cacert "$work/root.crt" https://127.0.0.1:18443/api/events | head -c 300)
check "live events through the proxy" "$(grep -c 'event: state' <<< "$events")" "1"
[ "$failed" = 0 ] || docker logs gs-check-https 2>&1 | tail -20
exit "$failed"
