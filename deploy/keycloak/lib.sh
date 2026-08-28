#!/bin/bash
# Shared helpers: env loading, admin token, REST calls.
# Sourced by the setup-*.sh scripts; not meant to be run directly.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# .env sits next to the scripts; every value can also come from the real
# environment, so CI can supply secrets without writing a file.
#
# Parsed rather than sourced: an unquoted value with spaces would otherwise run
# as a command (MDBOOK_ROLES=viewer editor admin executes `editor admin`), and
# a .env should never be able to execute anything.
if [ -f "${SCRIPT_DIR}/.env" ]; then
  while IFS= read -r line; do
    case "$line" in ''|'#'*) continue ;; esac
    case "$line" in *=*) ;; *) continue ;; esac
    key=${line%%=*}
    val=${line#*=}
    key=$(printf '%s' "$key" | tr -d '[:space:]')
    # Strip one layer of surrounding quotes, if present.
    case "$val" in
      \"*\") val=${val#\"}; val=${val%\"} ;;
      \'*\') val=${val#\'}; val=${val%\'} ;;
    esac
    # The real environment wins, so CI overrides the file.
    if [ -z "$(eval "printf '%s' \"\${$key:-}\"")" ]; then
      export "$key=$val"
    fi
  done < "${SCRIPT_DIR}/.env"
fi

KC_URL="${KC_URL:-http://localhost:8080}"
# The admin API is often reached privately (localhost, a compose network) while
# the issuer readers and mdbook use is the public one. Defaults to KC_URL.
KC_PUBLIC_URL="${KC_PUBLIC_URL:-$KC_URL}"
KC_ADMIN="${KC_ADMIN:-admin}"
KC_ADMIN_PASS="${KC_ADMIN_PASS:-}"
REALM="${KC_REALM:-mdbook}"
SITE_URL="${SITE_URL:-http://localhost:8080}"
SITE_ORIGIN="${SITE_ORIGIN:-$(printf '%s' "$SITE_URL" | sed -E 's#(https?://[^/]+).*#\1#')}"
MDBOOK_CLIENT_ID="${MDBOOK_CLIENT_ID:-owlexicon}"
MDBOOK_ROLES="${MDBOOK_ROLES:-viewer editor admin}"

KC_URL="${KC_URL%/}"
KC_PUBLIC_URL="${KC_PUBLIC_URL%/}"
SITE_URL="${SITE_URL%/}"

die() { echo "ERROR: $*" >&2; exit 1; }

require_env() {
  for v in "$@"; do
    [ -n "${!v}" ] || die "$v is not set (see ${SCRIPT_DIR}/.env.sample)"
  done
}

# Fail fast and clearly when Keycloak isn't reachable, rather than dying later
# on an opaque token-parse error.
preflight() {
  curl -sf -o /dev/null --max-time 10 "${KC_URL}/realms/master" \
    || die "Keycloak is not reachable at ${KC_URL}"
}

kc_login() {
  require_env KC_ADMIN_PASS
  TOKEN=$(curl -s --max-time 20 -X POST \
    "${KC_URL}/realms/master/protocol/openid-connect/token" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "username=${KC_ADMIN}" \
    --data-urlencode "password=${KC_ADMIN_PASS}" \
    -d "grant_type=password" -d "client_id=admin-cli" \
    | python3 -c 'import sys,json; print(json.load(sys.stdin).get("access_token",""))' 2>/dev/null)
  [ -n "$TOKEN" ] || die "could not authenticate to ${KC_URL} as ${KC_ADMIN}"
  AUTH="Authorization: Bearer ${TOKEN}"
  export TOKEN AUTH
}

# api <METHOD> <PATH-after-/admin> [json-body] -> body on stdout, status in API_STATUS
api() {
  local method=$1 path=$2 body=${3:-}
  local out
  if [ -n "$body" ]; then
    out=$(curl -s -w '\n%{http_code}' --max-time 30 -X "$method" \
      "${KC_URL}/admin${path}" -H "$AUTH" -H "Content-Type: application/json" -d "$body")
  else
    out=$(curl -s -w '\n%{http_code}' --max-time 30 -X "$method" \
      "${KC_URL}/admin${path}" -H "$AUTH")
  fi
  API_STATUS=$(printf '%s' "$out" | tail -n1)
  printf '%s' "$out" | sed '$d'
}

# Create if absent; report either way. Keeps the scripts re-runnable.
ensure() {
  local what=$1 path=$2 body=$3
  api POST "$path" "$body" >/dev/null
  case "$API_STATUS" in
    201|204) echo "  created  $what" ;;
    409)     echo "  exists   $what" ;;
    *)       die "$what -> HTTP $API_STATUS" ;;
  esac
}

json_get() { python3 -c "import sys,json; d=json.load(sys.stdin); print($1)" 2>/dev/null; }
