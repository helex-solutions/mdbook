#!/bin/bash
# Create the mdbook realm: public client, roles, the roles claim mapper, groups,
# and (optionally) a service account for testing enforcement.
#
# Usage: ./setup-realm.sh          (reads .env — see .env.sample)
# Re-runnable: anything that already exists is reported and skipped.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
. "${SCRIPT_DIR}/lib.sh"

export REALM
preflight
kc_login

echo "=== mdbook realm setup ==="
echo "Keycloak: ${KC_URL}  (issuer: ${KC_PUBLIC_URL})"
echo "Realm:    ${REALM}"
echo "Site:     ${SITE_URL}"
echo ""

echo "Realm"
# Realm-level settings this script OWNS. They are built here rather than left to
# the admin console because `ensure` skips a realm that already exists — so
# anything not in this body is silently absent from a rebuilt realm, and a realm
# rebuilt without SMTP locks out every invited reader (the first-broker-login
# flow confirms by email).
#
# Empty SMTP_HOST omits `smtpServer` entirely, so a realm that does not send
# mail is unchanged by this.
REALM_JSON=$(python3 - <<'PY'
import json, os
realm = os.environ["REALM"]
body = {
    "realm": realm, "enabled": True,
    "displayName": os.environ.get("KC_REALM_DISPLAY_NAME") or realm,
    "registrationAllowed": False, "loginWithEmailAllowed": True,
    "ssoSessionIdleTimeout": 1800, "ssoSessionMaxLifespan": 36000,
    "accessTokenLifespan": 300,
}
if os.environ.get("KC_LOGIN_THEME"):
    body["loginTheme"] = os.environ["KC_LOGIN_THEME"]
# Email as username: these realms federate to providers that all assert one, and
# a reader should not be maintaining a separate handle.
if os.environ.get("KC_EMAIL_AS_USERNAME", "").lower() == "true":
    body["registrationEmailAsUsername"] = True
    body["editUsernameAllowed"] = False
host = os.environ.get("SMTP_HOST", "")
if host:
    smtp = {
        "host": host,
        "port": os.environ.get("SMTP_PORT", "587"),
        "from": os.environ.get("SMTP_FROM", ""),
        "fromDisplayName": os.environ.get("SMTP_FROM_DISPLAY_NAME") or body["displayName"],
        "auth": os.environ.get("SMTP_AUTH", "false"),
        "starttls": os.environ.get("SMTP_STARTTLS", "true"),
        "ssl": os.environ.get("SMTP_SSL", "false"),
    }
    if os.environ.get("SMTP_REPLY_TO"): smtp["replyTo"] = os.environ["SMTP_REPLY_TO"]
    if smtp["auth"].lower() == "true":
        smtp["user"] = os.environ.get("SMTP_USERNAME", "")
        smtp["password"] = os.environ.get("SMTP_PASSWORD", "")
    body["smtpServer"] = smtp
print(json.dumps(body))
PY
)
export REALM_JSON

ensure "realm ${REALM}" "/realms" "$REALM_JSON"

# `ensure` leaves an EXISTING realm alone, which is right for everything it
# creates but wrong for these settings: a realm provisioned before SMTP existed
# would never gain it. Apply them to a realm that is already there, by reading
# it and putting back only the fields above — anything set by hand elsewhere in
# the realm survives.
if [ "$API_STATUS" = "409" ]; then
  CURRENT=$(api GET "/realms/${REALM}")
  MERGED=$(printf '%s' "$CURRENT" | python3 -c '
import json, sys, os
cur = json.load(sys.stdin)
own = json.loads(os.environ["REALM_JSON"])
changed = [k for k, v in own.items() if k not in ("realm", "enabled") and cur.get(k) != v]
cur.update({k: v for k, v in own.items() if k not in ("realm", "enabled")})
print(json.dumps({"body": cur, "changed": changed}))
')
  CHANGED=$(printf '%s' "$MERGED" | python3 -c 'import json,sys; print(",".join(json.load(sys.stdin)["changed"]))')
  if [ -n "$CHANGED" ]; then
    api PUT "/realms/${REALM}" \
        "$(printf '%s' "$MERGED" | python3 -c 'import json,sys; print(json.dumps(json.load(sys.stdin)["body"]))')" >/dev/null
    case "$API_STATUS" in
      200|204) echo "  updated  realm settings: ${CHANGED}" ;;
      *)       die "update realm -> HTTP $API_STATUS" ;;
    esac
  else
    echo "  ok       realm settings already match"
  fi
fi

echo "Client"
# The redirect URI is exactly the path `mdbook serve` listens on. A public
# client is right: the code exchange happens server-side in serve, and PKCE is
# what protects it. (Set AUTH_OIDC_CLIENT_SECRET to use a confidential one.)
ensure "client ${MDBOOK_CLIENT_ID}" "/realms/${REALM}/clients" "$(cat <<JSON
{"clientId":"${MDBOOK_CLIENT_ID}","name":"mdbook site","enabled":true,
 "publicClient":true,"standardFlowEnabled":true,
 "directAccessGrantsEnabled":false,"serviceAccountsEnabled":false,
 "redirectUris":["${SITE_URL}/auth/callback"],
 "webOrigins":["${SITE_ORIGIN}"],
 "attributes":{"pkce.code.challenge.method":"S256",
               "post.logout.redirect.uris":"${SITE_URL}/*"}}
JSON
)"

CID=$(api GET "/realms/${REALM}/clients?clientId=${MDBOOK_CLIENT_ID}" | json_get 'd[0]["id"]')
[ -n "$CID" ] || die "client ${MDBOOK_CLIENT_ID} not found after creation"

echo "Roles"
for role in $MDBOOK_ROLES; do
  ensure "role ${role}" "/realms/${REALM}/clients/${CID}/roles" \
    "{\"name\":\"${role}\",\"description\":\"mdbook ${role}\"}"
done

echo "Roles claim mapper"
# mdbook reads role names from the `roles` claim by default; point
# auth.roleClaims elsewhere (e.g. realm_access.roles) to use a different one.
ensure "mapper roles" "/realms/${REALM}/clients/${CID}/protocol-mappers/models" "$(cat <<JSON
{"name":"roles","protocol":"openid-connect",
 "protocolMapper":"oidc-usermodel-client-role-mapper",
 "config":{"claim.name":"roles","jsonType.label":"String","multivalued":"true",
           "usermodel.clientRoleMapping.clientId":"${MDBOOK_CLIENT_ID}",
           "access.token.claim":"true","id.token.claim":"true",
           "userinfo.token.claim":"true"}}
JSON
)"

echo "Groups"
for role in $MDBOOK_ROLES; do
  ensure "group mdbook-${role}" "/realms/${REALM}/groups" "{\"name\":\"mdbook-${role}\"}"
  GID=$(api GET "/realms/${REALM}/groups?search=mdbook-${role}" \
        | json_get "[g['id'] for g in d if g['name']=='mdbook-${role}'][0]")
  RJSON=$(api GET "/realms/${REALM}/clients/${CID}/roles/${role}")
  api POST "/realms/${REALM}/groups/${GID}/role-mappings/clients/${CID}" "[${RJSON}]" >/dev/null
  echo "  mapped   mdbook-${role} -> ${role}"
done

if [ -n "${MDBOOK_DEFAULT_ROLE:-}" ]; then
  echo "Default role (${MDBOOK_DEFAULT_ROLE}) — every user who can log in gets it"
  RJSON=$(api GET "/realms/${REALM}/clients/${CID}/roles/${MDBOOK_DEFAULT_ROLE}")
  DID=$(api GET "/realms/${REALM}/roles/default-roles-${REALM}" | json_get 'd["id"]')
  api POST "/realms/${REALM}/roles-by-id/${DID}/composites" "[${RJSON}]" >/dev/null
  echo "  granted  default-roles-${REALM} -> ${MDBOOK_DEFAULT_ROLE}"
fi

if [ -n "${MDBOOK_TEST_ROLE:-}" ]; then
  echo "Test service account (role: ${MDBOOK_TEST_ROLE})"
  ensure "client mdbook-test" "/realms/${REALM}/clients" "$(cat <<JSON
{"clientId":"mdbook-test","name":"mdbook test (service account)","enabled":true,
 "publicClient":false,"standardFlowEnabled":false,"serviceAccountsEnabled":true,
 "redirectUris":[]}
JSON
)"
  TID=$(api GET "/realms/${REALM}/clients?clientId=mdbook-test" | json_get 'd[0]["id"]')
  ensure "mapper roles (test)" "/realms/${REALM}/clients/${TID}/protocol-mappers/models" "$(cat <<JSON
{"name":"roles","protocol":"openid-connect",
 "protocolMapper":"oidc-usermodel-client-role-mapper",
 "config":{"claim.name":"roles","jsonType.label":"String","multivalued":"true",
           "usermodel.clientRoleMapping.clientId":"${MDBOOK_CLIENT_ID}",
           "access.token.claim":"true","id.token.claim":"true"}}
JSON
)"
  SA=$(api GET "/realms/${REALM}/clients/${TID}/service-account-user" | json_get 'd["id"]')
  RJSON=$(api GET "/realms/${REALM}/clients/${CID}/roles/${MDBOOK_TEST_ROLE}")
  api POST "/realms/${REALM}/users/${SA}/role-mappings/clients/${CID}" "[${RJSON}]" >/dev/null
  echo "  granted  service account -> ${MDBOOK_TEST_ROLE}"
fi

echo ""
echo "Done. mdbook config:"
echo "  auth:"
echo "    issuer: ${KC_PUBLIC_URL}/realms/${REALM}"
echo "    clientId: ${MDBOOK_CLIENT_ID}"
