#!/bin/bash
# Add identity providers to the mdbook realm.
#
# Usage: ./setup-idp.sh google [more…]
#        ./setup-idp.sh github
#        ./setup-idp.sh all
#
# Credentials come from .env (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET,
# GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET, …), which
# is gitignored — keep it chmod 600. A provider missing either value is skipped
# with a message rather than half-created, so re-running without a secret leaves
# an already-configured provider alone.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
. "${SCRIPT_DIR}/lib.sh"

# create_idp <alias> <display> <authz> <token> <userinfo> <jwks> <issuer> <id> <secret> [scope] [extra-authz-query] [discovery]
create_idp() {
  local alias=$1 display=$2 authz=$3 token=$4 userinfo=$5 jwks=$6 issuer=$7
  local cid=$8 secret=$9 scope=${10:-"openid email profile"} extra=${11:-} discovery=${12:-}

  if [ -z "$cid" ] || [ -z "$secret" ]; then
    echo "  SKIPPED  ${alias}: set ${alias^^}_CLIENT_ID and ${alias^^}_CLIENT_SECRET in .env"
    return
  fi
  [ -n "$extra" ] && authz="${authz}?${extra}"

  local body
  body=$(python3 - "$alias" "$display" "$authz" "$token" "$userinfo" "$jwks" "$issuer" "$cid" "$secret" "$scope" "$discovery" "$FIRST_BROKER_LOGIN_FLOW" "$IDP_TRUST_EMAIL" <<'PY'
import json, sys
a, disp, authz, token, ui, jwks, iss, cid, sec, scope, disco, fbl, trust = sys.argv[1:14]
print(json.dumps({
    "alias": a, "providerId": "oidc", "enabled": True, "displayName": disp,
    "trustEmail": trust == "true", "linkOnly": False, "hideOnLogin": False,
    # Keep the provider's tokens so a session can be refreshed against it.
    "storeToken": True,
    "addReadTokenRoleOnCreate": False, "authenticateByDefault": False,
    "firstBrokerLoginFlowAlias": fbl,
    "updateProfileFirstLoginMode": "on",
    "config": {
        "issuer": iss, "authorizationUrl": authz, "tokenUrl": token,
        "userInfoUrl": ui, "jwksUrl": jwks, "useJwksUrl": "true",
        "validateSignature": "true", "clientAuthMethod": "client_secret_post",
        "defaultScope": scope, "syncMode": "IMPORT",
        "clientId": cid, "clientSecret": sec,
        **({"discoveryUrl": disco} if disco else {}),
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
  # Record who the user is at the provider, and how they authenticated, as user
  # attributes — the same mappers the emr realm carries.
  local name src m
  for claim in idp_sub:sub amr:amr acr:acr; do
    name=${claim%%:*}; src=${claim##*:}
    m=$(printf '{"name":"%s","identityProviderAlias":"%s","identityProviderMapper":"oidc-user-attribute-idp-mapper","config":{"syncMode":"FORCE","claim":"%s","user.attribute":"%s"}}' "$name" "$alias" "$src" "$name")
    api POST "/realms/${REALM}/identity-provider/instances/${alias}/mappers" "$m" >/dev/null
    case "$API_STATUS" in
      201|204) echo "  created  mapper ${name}" ;;
      # Keycloak answers 400 (not 409) for a duplicate identity-provider mapper,
      # so a re-run has to check whether the name is already there before
      # calling it an error.
      400|409)
        if api GET "/realms/${REALM}/identity-provider/instances/${alias}/mappers" \
             | grep -q "\"name\"[[:space:]]*:[[:space:]]*\"${name}\""; then
          echo "  exists   mapper ${name}"
        else
          echo "  WARN     mapper ${name} -> HTTP $API_STATUS"
        fi ;;
      *)       echo "  WARN     mapper ${name} -> HTTP $API_STATUS" ;;
    esac
  done

  echo "  NOTE     register this redirect URI with the provider:"
  echo "           ${KC_PUBLIC_URL}/realms/${REALM}/broker/${alias}/endpoint"
}

# The first-broker-login flow every provider here is bound to. The built-in one
# demands email verification or a password when a federated identity arrives for
# an account that already exists — a dead end on a realm with no SMTP whose users
# hold no passwords, which is exactly how invitations work on the docs realms
# (a reader is pre-created by email and put in mdbook-viewer before first login).
# Those realms carry a copied flow with Handle Existing Account DISABLED and
# idp-auto-link ALTERNATIVE; point this at it. See docs/keycloak.md.
FIRST_BROKER_LOGIN_FLOW="${KC_FIRST_BROKER_LOGIN_FLOW:-first broker login}"

# Whether to take the provider's word that the address it returns is verified.
# Default false — the conservative reading, and what an untrusted provider
# deserves. The docs realms set it true, because they have no SMTP: without it a
# reader's address is imported unverified, and any later flow that asks for
# verification has no way to deliver the mail. Both providers wired here return
# only verified addresses (Google from the id_token, GitHub from /user/emails
# under the user:email scope), so trusting them is a statement about those two
# providers, not a blanket one. Live docs-emr carries trustEmail=true.
IDP_TRUST_EMAIL="${KC_IDP_TRUST_EMAIL:-false}"

setup_github() {
  # GitHub is OAuth2, NOT OpenID Connect, so it cannot go through create_idp:
  # there is no issuer, no JWKS and no id_token. Keycloak ships a built-in
  # `github` provider that already knows the endpoints, so only the credentials
  # are needed — and stock themes give it the Octocat for free.
  local cid="${GITHUB_CLIENT_ID:-}" secret="${GITHUB_CLIENT_SECRET:-}"
  if [ -z "$cid" ] || [ -z "$secret" ]; then
    echo "  SKIPPED  github: set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET in .env"
    return
  fi

  local body
  body=$(python3 - "$cid" "$secret" "$FIRST_BROKER_LOGIN_FLOW" "$IDP_TRUST_EMAIL" <<'PY'
import json, sys
cid, sec, fbl, trust = sys.argv[1:5]
print(json.dumps({
    "alias": "github", "providerId": "github", "enabled": True,
    "displayName": "Continue with GitHub",
    "trustEmail": trust == "true", "linkOnly": False, "hideOnLogin": False,
    "storeToken": True, "addReadTokenRoleOnCreate": False,
    "authenticateByDefault": False,
    "firstBrokerLoginFlowAlias": fbl,
    "updateProfileFirstLoginMode": "on",
    "config": {
        # user:email is what makes GitHub return the verified PRIMARY address for
        # an account whose profile email is private. Without it the identity
        # arrives with no email and cannot be matched to a pre-created invitee.
        "defaultScope": "read:user user:email",
        "syncMode": "IMPORT",
        "clientId": cid, "clientSecret": sec,
    },
}))
PY
)
  api POST "/realms/${REALM}/identity-provider/instances" "$body" >/dev/null
  case "$API_STATUS" in
    201|204) echo "  created  github" ;;
    409)     api PUT "/realms/${REALM}/identity-provider/instances/github" "$body" >/dev/null
             echo "  updated  github" ;;
    *)       die "idp github -> HTTP $API_STATUS" ;;
  esac

  # No idp_sub/amr/acr mappers, deliberately: those claims are OIDC, GitHub has
  # none of them, and oidc-user-attribute-idp-mapper is the wrong mapper type for
  # a github provider in any case.

  echo "  NOTE     register this callback on the GitHub OAuth App:"
  echo "           ${KC_PUBLIC_URL}/realms/${REALM}/broker/github/endpoint"
  echo "  NOTE     GitHub login cannot be limited to an organisation — any GitHub"
  echo "           account can authenticate. The role gate is what admits a reader."
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
    "${GOOGLE_HD:+hd=${GOOGLE_HD}}" \
    "https://accounts.google.com/.well-known/openid-configuration"
}

[ $# -gt 0 ] || { echo "Usage: $0 google|github|all"; exit 0; }

preflight
kc_login
echo "=== identity providers (realm ${REALM}) ==="
for arg in "$@"; do
  case "$arg" in
    google) setup_google ;;
    github) setup_github ;;
    all)    setup_google
            setup_github ;;
    *)      die "unknown provider: $arg" ;;
  esac
done

if [ -z "${MDBOOK_DEFAULT_ROLE:-}" ]; then
  echo ""
  echo "REMINDER: a federated user arrives with no roles, so they authenticate"
  echo "          but get 403 on any role-gated section. Set MDBOOK_DEFAULT_ROLE"
  echo "          in .env and re-run setup-realm.sh, or assign groups per user."
fi
