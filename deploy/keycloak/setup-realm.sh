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

echo "User profile"
# The declarative user profile is realm state too, and `ensure` never reaches it:
# a rebuilt realm comes back with Keycloak's default attributes and nothing else.
# These are the parts this script OWNS. They are applied by reading the live
# profile and writing back only them, so every other attribute, validation and
# annotation survives — and a profile that already matches is not written at all.
#
#   KC_EMAIL_AS_USERNAME=true  email and username become admin-only. The review
#                              page then shows neither, which also keeps a reader
#                              from skipping the link confirmation: Keycloak skips
#                              it when either is changed there.
#   KC_PERSONAL_IDENTIFIER     required | optional | empty (not managed). Declares
#                              personalIdentifier — country + national code in one
#                              value, as GovSSO issues it (EE39001010001) — which
#                              the helex theme shows as a country select and a
#                              code input.
# `api` runs in a subshell here, so API_STATUS is not visible; the parser below
# rejects anything that is not a profile instead.
PROFILE=$(api GET "/realms/${REALM}/users/profile")
PROFILE_PLAN=$(printf '%s' "$PROFILE" | python3 -c '
import copy, json, os, sys
try:
    cur = json.load(sys.stdin)
    assert isinstance(cur.get("attributes"), list)
except Exception:
    sys.exit("ERROR: could not read the user profile of this realm")
new = copy.deepcopy(cur)
attrs = new.setdefault("attributes", [])
changed, managed = [], False

def own(name, apply):
    a = next((x for x in attrs if x.get("name") == name), None)
    before = json.dumps(a, sort_keys=True)
    if a is None:
        a = {"name": name}
        attrs.append(a)
    apply(a)
    if json.dumps(a, sort_keys=True) != before:
        changed.append(name)

if os.environ.get("KC_EMAIL_AS_USERNAME", "").lower() == "true":
    managed = True
    def admin_only(a):
        a["permissions"] = {**a.get("permissions", {}), "edit": ["admin"]}
    own("username", admin_only)
    own("email", admin_only)

mode = os.environ.get("KC_PERSONAL_IDENTIFIER", "").lower()
if mode not in ("", "required", "optional"):
    sys.exit("ERROR: KC_PERSONAL_IDENTIFIER must be required, optional or empty, not %r" % mode)
if mode:
    managed = True
    def personal_identifier(a):
        a["displayName"] = "${personalIdentifier}"
        a["multivalued"] = False
        a.setdefault("annotations", {}).update({
            "helexWidget": "personal-identifier",
            "inputHelperTextAfter": "${personalIdentifierHelp}",
        })
        # The reader fills it in on first login, so they may edit it.
        a["permissions"] = {**a.get("permissions", {}), "edit": ["admin", "user"], "view": ["admin", "user"]}
        # error-message is a bare message key; "${...}" would render literally.
        a.setdefault("validations", {}).update({
            "length": {"min": 5, "max": 64},
            "pattern": {"pattern": "^[A-Z]{2}[A-Za-z0-9]{3,}$", "error-message": "personalIdentifierInvalid"},
        })
        if mode == "required":
            a["required"] = {"roles": ["user"]}
        else:
            a.pop("required", None)
    own("personalIdentifier", personal_identifier)

print(json.dumps({"body": new, "changed": changed, "managed": managed}))
')
PROFILE_CHANGED=$(printf '%s' "$PROFILE_PLAN" | json_get '",".join(d["changed"])')
if [ -n "$PROFILE_CHANGED" ]; then
  api PUT "/realms/${REALM}/users/profile" \
      "$(printf '%s' "$PROFILE_PLAN" | json_get 'json.dumps(d["body"])')" >/dev/null
  case "$API_STATUS" in
    200|204) echo "  updated  user profile: ${PROFILE_CHANGED}" ;;
    *)       die "update user profile -> HTTP $API_STATUS" ;;
  esac
elif [ "$(printf '%s' "$PROFILE_PLAN" | json_get 'd["managed"]')" = "True" ]; then
  echo "  ok       user profile already matches"
else
  echo "  skipped  user profile (KC_EMAIL_AS_USERNAME and KC_PERSONAL_IDENTIFIER unset)"
fi

echo "Events"
# Saved user events are the only record of a successful login or account link:
# Keycloak's log listener writes those at DEBUG, so the container log shows
# failures only. Owned here, like the user profile, so a rebuilt realm keeps it.
#
#   KC_SAVE_EVENTS             true | false | empty (not managed)
#   KC_EVENTS_EXPIRATION_DAYS  how long saved events are kept (default 90;
#                              0 keeps them forever). Events carry IP addresses,
#                              so an expiry is the default, not an option.
#
# Only eventsEnabled and eventsExpiration are written; listeners, event types
# and admin-event settings stay as found, and a config that matches is not
# written at all.
EVENTS_PLAN=$(api GET "/realms/${REALM}/events/config" | python3 -c '
import json, os, sys
save = os.environ.get("KC_SAVE_EVENTS", "").lower()
if save not in ("", "true", "false"):
    sys.exit("ERROR: KC_SAVE_EVENTS must be true, false or empty, not %r" % save)
if not save:
    print(json.dumps({"managed": False, "changed": []}))
    sys.exit()
days = os.environ.get("KC_EVENTS_EXPIRATION_DAYS") or "90"
if not days.isdigit():
    sys.exit("ERROR: KC_EVENTS_EXPIRATION_DAYS must be a whole number of days, not %r" % days)
try:
    cur = json.load(sys.stdin)
    assert isinstance(cur, dict) and "eventsEnabled" in cur
except Exception:
    sys.exit("ERROR: could not read the events config of this realm")
changed = []
if bool(cur.get("eventsEnabled")) != (save == "true"):
    cur["eventsEnabled"] = save == "true"
    changed.append("eventsEnabled")
if save == "true":
    # Keycloak reports an unset expiry as absent and clears it with 0.
    expiry = int(days) * 86400
    if (cur.get("eventsExpiration") or 0) != expiry:
        cur["eventsExpiration"] = expiry
        changed.append("eventsExpiration=%sd" % days)
print(json.dumps({"managed": True, "changed": changed, "body": cur}))
')
EVENTS_CHANGED=$(printf '%s' "$EVENTS_PLAN" | json_get '",".join(d["changed"])')
if [ -n "$EVENTS_CHANGED" ]; then
  api PUT "/realms/${REALM}/events/config" \
      "$(printf '%s' "$EVENTS_PLAN" | json_get 'json.dumps(d["body"])')" >/dev/null
  case "$API_STATUS" in
    200|204) echo "  updated  events: ${EVENTS_CHANGED}" ;;
    *)       die "update events config -> HTTP $API_STATUS" ;;
  esac
elif [ "$(printf '%s' "$EVENTS_PLAN" | json_get 'd["managed"]')" = "True" ]; then
  echo "  ok       events already match"
else
  echo "  skipped  events (KC_SAVE_EVENTS unset)"
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
