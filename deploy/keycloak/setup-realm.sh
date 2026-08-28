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

preflight
kc_login

echo "=== mdbook realm setup ==="
echo "Keycloak: ${KC_URL}  (issuer: ${KC_PUBLIC_URL})"
echo "Realm:    ${REALM}"
echo "Site:     ${SITE_URL}"
echo ""

echo "Realm"
ensure "realm ${REALM}" "/realms" "$(cat <<JSON
{"realm":"${REALM}","enabled":true,"displayName":"${REALM}",
 "registrationAllowed":false,"loginWithEmailAllowed":true,
 "ssoSessionIdleTimeout":1800,"ssoSessionMaxLifespan":36000,"accessTokenLifespan":300}
JSON
)"

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
