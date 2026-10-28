#!/usr/bin/env bash
# Checks the production site from the Internet, as a visitor would. Run by the verify job of
# deploy.yml after each deployment; also runs by hand: deploy/smoke_test.sh <domain>.
#
# Fails when the dashboard is not served over HTTPS with a trusted certificate, when HTTP does
# not redirect to HTTPS, when a security header set by deploy/Caddyfile is missing, when the
# API answers without a session (authentication off) or does not answer (back down), or when
# a port that only the VM or the Docker network may use is reachable from the Internet.
set -euo pipefail

DOMAIN="${1:-${SITE_DOMAIN:-}}"
# SSH is limited to one address by the NSG; MLflow, PostgreSQL and the API are never published.
CLOSED_PORTS=(22 5000 5432 8000)
# Caddy requests its certificate on its first start: wait for it, up to 5 minutes by default.
ATTEMPTS="${SMOKE_ATTEMPTS:-30}"
DELAY="${SMOKE_DELAY:-10}"

if [[ ! "$DOMAIN" =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$ ]]; then
  echo "::error::Missing or invalid domain '${DOMAIN}'. Usage: $0 <domain>"
  exit 2
fi
SITE="https://${DOMAIN}"

failures=0
report=()

# check <name> <ok|ko> <detail>: prints the result and keeps it for the job summary.
check() {
  if [[ "$2" == ok ]]; then
    echo "OK    $1: $3"
    report+=("| $1 | ✅ | $3 |")
  else
    echo "::error::$1: $3"
    report+=("| $1 | ❌ | $3 |")
    failures=$((failures + 1))
  fi
}

# 1. The dashboard over HTTPS; curl refuses a certificate it does not trust.
code=000
for ((i = 1; i <= ATTEMPTS; i++)); do
  code=$(curl --silent --output /dev/null --write-out '%{http_code}' --max-time 10 "${SITE}/" || true)
  [[ "$code" == 200 ]] && break
  if ((i < ATTEMPTS)); then
    echo "Attempt ${i}/${ATTEMPTS}: HTTPS answers ${code}, retrying in ${DELAY} s"
    sleep "$DELAY"
  fi
done
if [[ "$code" == 200 ]]; then
  check "HTTPS" ok "dashboard served, certificate trusted"
else
  check "HTTPS" ko "no 200 after ${ATTEMPTS} attempts (last status: ${code}; 000 = no connection or untrusted certificate)"
fi

# 2. Plain HTTP only redirects: the session cookie must never travel in clear.
answer=$(curl --silent --output /dev/null --write-out '%{http_code} %{redirect_url}' --max-time 10 "http://${DOMAIN}/" || true)
if [[ "${answer%% *}" =~ ^30[178]$ && "${answer#* }" == "${SITE}/" ]]; then
  check "HTTP redirect" ok "${answer%% *} to ${SITE}/"
else
  check "HTTP redirect" ko "expected a redirect to ${SITE}/, got '${answer}'"
fi

# 3. The security headers of deploy/Caddyfile.
headers=$(curl --silent --dump-header - --output /dev/null --max-time 10 "${SITE}/" || true)
for header in 'strict-transport-security: max-age=' 'x-content-type-options: nosniff' 'x-frame-options: deny'; do
  if grep -qi "^${header}" <<< "$headers"; then
    check "Header ${header%%:*}" ok "present"
  else
    check "Header ${header%%:*}" ko "missing or different (expected '${header}')"
  fi
done

# 4. The API answers through the proxy, and refuses a request without a session.
for path in /api/consommations /api/auth/me; do
  code=$(curl --silent --output /dev/null --write-out '%{http_code}' --max-time 10 "${SITE}${path}" || true)
  case "$code" in
    401) check "API ${path}" ok "401 without a session" ;;
    200) check "API ${path}" ko "200 without a session: authentication is off (AUTH_ENABLED in back.env)" ;;
    502 | 503 | 504) check "API ${path}" ko "${code}: the proxy cannot reach the back" ;;
    *) check "API ${path}" ko "unexpected status ${code}" ;;
  esac
done

# 5. Nothing but 80 and 443 from the Internet.
for port in "${CLOSED_PORTS[@]}"; do
  # The inner bash receives the domain and the port as arguments: nothing is interpolated.
  # shellcheck disable=SC2016
  if timeout 5 bash -c 'exec 3<>"/dev/tcp/$1/$2"' _ "$DOMAIN" "$port" 2>/dev/null; then
    check "Port ${port}" ko "reachable from the Internet"
  else
    check "Port ${port}" ok "closed or filtered"
  fi
done

if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  {
    echo "### Production check: ${SITE}/"
    echo
    echo "| Check | Result | Detail |"
    echo "|---|---|---|"
    printf '%s\n' "${report[@]}"
  } >> "$GITHUB_STEP_SUMMARY"
fi

if ((failures > 0)); then
  echo "${failures} check(s) failed."
  exit 1
fi
echo "All checks passed."
