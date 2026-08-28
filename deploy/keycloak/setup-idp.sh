#!/bin/bash
# Add identity providers to the mdbook realm.
#
# Usage: ./setup-idp.sh google [more…]
#        ./setup-idp.sh all
#
# Credentials come from .env (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET, …). A
# provider with no client id is skipped with a message rather than half-created.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
. "${SCRIPT_DIR}/lib.sh"

# create_idp <alias> <display> <authz> <token> <userinfo> <jwks> <issuer> <id> <secret> [scope] [extra-authz-query]
create_idp() {
  local alias=$1 display=$2 authz=$3 token=$4 userinfo=$5 jwks=$6 issuer=$7
  local cid=$8 secret=$9 scope=${10:-"openid email profile"} extra=${11:-}

  if [ -z "$cid" ] || [ -z "$secret" ]; then
    echo "  SKIPPED  ${alias}: set ${alias^^}_CLIENT_ID and ${alias^^}_CLIENT_SECRET in .env"
    return
  fi
  [ -n "$extra" ] && authz="${authz}?${extra}"

  local body
  body=$(python3 - "$alias" "$display" "$authz" "$token" "$userinfo" "$jwks" "$issuer" "$cid" "$secret" "$scope" <<'PY'
import json, sys
a, disp, authz, token, ui, jwks, iss, cid, sec, scope = sys.argv[1:11]
print(json.dumps({
    "alias": a, "providerId": "oidc", "enabled": True, "displayName": disp,
    "trustEmail": False, "storeToken": False, "linkOnly": False, "hideOnLogin": False,
    "firstBrokerLoginFlowAlias": "first broker login",
    "updateProfileFirstLoginMode": "on",
    "config": {
        "issuer": iss, "authorizationUrl": authz, "tokenUrl": token,
        "userInfoUrl": ui, "jwksUrl": jwks, "useJwksUrl": "true",
        "validateSignature": "true", "clientAuthMethod": "client_secret_post",
        "defaultScope": scope, "syncMode": "IMPORT",
        "clientId": cid, "clientSecret": sec,
    },
}))
PY
)
  api POST "/realms/${REALM}/identity-provider/instances" "$body" >/dev/null
  case "$API_STATUS" in
    201|204) echo "  created  ${alias}" ;;
    409)     api PUT "/realms/${REALM}/identity-provider/instances/${alias}" "$body" >/dev/null
             echo "  updated  ${alias}" ;;
    *)       die "idp ${alias} -> HTTP $API_STATUS" ;;
  esac
  echo "  NOTE     register this redirect URI with the provider:"
  echo "           ${KC_PUBLIC_URL}/realms/${REALM}/broker/${alias}/endpoint"
}

setup_google() {
  # Google's own discovery document supplies these; they are spelled out so the
  # provider works on a network that cannot reach the discovery URL at setup.
  create_idp google "Continue with Google" \
    "https://accounts.google.com/o/oauth2/v2/auth" \
    "https://oauth2.googleapis.com/token" \
    "https://openidconnect.googleapis.com/v1/userinfo" \
    "https://www.googleapis.com/oauth2/v3/certs" \
    "https://accounts.google.com" \
    "${GOOGLE_CLIENT_ID:-}" "${GOOGLE_CLIENT_SECRET:-}" \
    "openid email profile" \
    "${GOOGLE_HD:+hd=${GOOGLE_HD}}"
}

[ $# -gt 0 ] || { echo "Usage: $0 google|all"; exit 0; }

preflight
kc_login
echo "=== identity providers (realm ${REALM}) ==="
for arg in "$@"; do
  case "$arg" in
    google) setup_google ;;
    all)    setup_google ;;
    *)      die "unknown provider: $arg" ;;
  esac
done

if [ -z "${MDBOOK_DEFAULT_ROLE:-}" ]; then
  echo ""
  echo "REMINDER: a federated user arrives with no roles, so they authenticate"
  echo "          but get 403 on any role-gated section. Set MDBOOK_DEFAULT_ROLE"
  echo "          in .env and re-run setup-realm.sh, or assign groups per user."
fi
