#!/bin/bash
# Give the realm a first-broker-login flow that admits a PRE-CREATED reader.
#
# Usage: ./setup-first-broker-login.sh
#        KC_REALM=docs-tx ./setup-first-broker-login.sh
#
# Why this exists. On these realms a reader is invited by being created by email
# and put in the mdbook-<role> group BEFORE they ever log in. The built-in
# `first broker login` flow cannot complete that: when the federated identity
# arrives for an account that already exists, "Create User If Unique" declines,
# and the only remaining branch is "Handle Existing Account", which demands
# either email verification — the realm has no SMTP — or a password, which an
# invitee has never had. Both are dead ends, and the reader sees an error rather
# than the site.
#
# The fix is two edits to a copy of the built-in flow:
#
#   1. "Handle Existing Account" sub-flow -> DISABLED
#   2. add `idp-auto-link` ("Automatically set existing user") to the
#      "User creation or linking" sub-flow as ALTERNATIVE, AFTER
#      "Create User If Unique"
#
# Order matters: auto-link consumes what create-if-unique declined. This is the
# shape the live docs-emr realm carries; the script exists so the next realm
# gets it from a file rather than from someone's memory of an admin console.
#
# The flow is created but NOT bound here — binding is per identity provider
# (`firstBrokerLoginFlowAlias`), which setup-idp.sh does via
# KC_FIRST_BROKER_LOGIN_FLOW. Run this first, then point that at the alias this
# prints.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
. "${SCRIPT_DIR}/lib.sh"

FLOW="${KC_FIRST_BROKER_LOGIN_FLOW:-${REALM} first broker login}"

urlenc() { python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1]))' "$1"; }

preflight
kc_login
echo "=== first broker login (realm ${REALM}) ==="
echo "  flow: ${FLOW}"

# ---- 1. the copy -----------------------------------------------------------
api POST "/realms/${REALM}/authentication/flows/$(urlenc 'first broker login')/copy" \
    "$(printf '{"newName":"%s"}' "$FLOW")" >/dev/null
case "$API_STATUS" in
  201|204) echo "  created  flow" ;;
  409)     echo "  exists   flow (executions re-checked below)" ;;
  *)       die "copy flow -> HTTP $API_STATUS" ;;
esac

EXEC_PATH="/realms/${REALM}/authentication/flows/$(urlenc "$FLOW")/executions"

# ---- 2. Handle Existing Account -> DISABLED --------------------------------
# Matched on displayName, which the copy prefixes with the new flow name, so the
# suffix is the stable part. Keycloak has no id for a sub-flow that survives a
# re-copy, and matching on the provider is impossible: a sub-flow has none.
hea=$(api GET "$EXEC_PATH" | python3 -c '
import json, sys
for e in json.load(sys.stdin):
    if e.get("displayName","").endswith("Handle Existing Account"):
        print(json.dumps(e)); break
')
[ -n "$hea" ] || die "no \"Handle Existing Account\" sub-flow in ${FLOW}"

if printf '%s' "$hea" | grep -q '"requirement": *"DISABLED"'; then
  echo "  ok       Handle Existing Account already DISABLED"
else
  api PUT "$EXEC_PATH" \
      "$(printf '%s' "$hea" | python3 -c 'import json,sys; e=json.load(sys.stdin); e["requirement"]="DISABLED"; print(json.dumps(e))')" >/dev/null
  case "$API_STATUS" in
    200|204) echo "  set      Handle Existing Account -> DISABLED" ;;
    *)       die "disable Handle Existing Account -> HTTP $API_STATUS" ;;
  esac
fi

# ---- 3. idp-auto-link into "User creation or linking" ----------------------
# Appended, which puts it after "Create User If Unique" — the order the comment
# at the top explains. A second run must not append a duplicate.
if api GET "$EXEC_PATH" | grep -q '"idp-auto-link"'; then
  echo "  ok       Automatically set existing user already present"
else
  SUB="${FLOW} User creation or linking"
  api POST "/realms/${REALM}/authentication/flows/$(urlenc "$SUB")/executions/execution" \
      '{"provider":"idp-auto-link"}' >/dev/null
  case "$API_STATUS" in
    201|204) echo "  added    Automatically set existing user" ;;
    *)       die "add idp-auto-link -> HTTP $API_STATUS" ;;
  esac
fi

# It is created REQUIRED (or DISABLED, depending on version); it has to be
# ALTERNATIVE or it runs for every brokered login, including brand-new users.
al=$(api GET "$EXEC_PATH" | python3 -c '
import json, sys
for e in json.load(sys.stdin):
    if e.get("providerId") == "idp-auto-link":
        print(json.dumps(e)); break
')
[ -n "$al" ] || die "idp-auto-link missing after add"
if printf '%s' "$al" | grep -q '"requirement": *"ALTERNATIVE"'; then
  echo "  ok       Automatically set existing user is ALTERNATIVE"
else
  api PUT "$EXEC_PATH" \
      "$(printf '%s' "$al" | python3 -c 'import json,sys; e=json.load(sys.stdin); e["requirement"]="ALTERNATIVE"; print(json.dumps(e))')" >/dev/null
  case "$API_STATUS" in
    200|204) echo "  set      Automatically set existing user -> ALTERNATIVE" ;;
    *)       die "set idp-auto-link ALTERNATIVE -> HTTP $API_STATUS" ;;
  esac
fi

echo ""
echo "  bind it with:  KC_FIRST_BROKER_LOGIN_FLOW=\"${FLOW}\" ./setup-idp.sh google github"
