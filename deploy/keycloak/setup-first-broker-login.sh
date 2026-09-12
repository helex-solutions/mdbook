#!/bin/bash
# Give the realm a first-broker-login flow that CONFIRMS a second provider.
#
# Usage: ./setup-first-broker-login.sh
#        KC_REALM=docs-tx ./setup-first-broker-login.sh
#
# The problem. A reader here may arrive through more than one provider — Google
# today, GitHub tomorrow — and Keycloak matches them on email. Left alone, the
# built-in flow asks the person to confirm that link by email. These realms used
# to have no SMTP, so that path dead-ended, and the flow was edited to link
# SILENTLY instead: Handle Existing Account DISABLED, `idp-auto-link` added.
#
# Silent linking means anyone who can make a provider assert an address owns the
# account at that address, including its roles. With SMTP configured that trade
# is no longer necessary, so this script now builds the confirming shape:
#
#   1. "Create User If Unique" must come BEFORE "Handle Existing Account" —
#      alternatives run in order, and reversed, a brand-new reader is sent down
#      the existing-account branch.
#   2. "Handle Existing Account" -> ALTERNATIVE, which is
#      Confirm link -> Verify existing account by Email.
#   3. "Verify Existing Account by Re-authentication" -> DISABLED. Its only
#      execution is a password form, and nobody in these realms has a password;
#      offering it is a dead end a reader can pick by mistake.
#   4. `idp-auto-link` REMOVED if present. This is the one that matters: it sits
#      as a later ALTERNATIVE, so if confirmation is declined or expires the
#      flow falls through and links anyway — leaving it in place makes the
#      confirmation cosmetic.
#
# THE REALM MUST HAVE SMTP before this is bound, or every invitation dead-ends
# with no way back. Check with POST /admin/realms/<realm>/testSMTPConnection.
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

# SMTP is a hard prerequisite: without it the confirmation email cannot be sent
# and an invited reader is simply locked out. Warn loudly rather than build a
# flow nobody can complete.
if api GET "/realms/${REALM}" | grep -q '"smtpServer":{}'; then
  echo "  WARN     realm has NO smtpServer — the confirm-by-email step cannot"
  echo "           complete. Configure SMTP before binding this flow."
fi

EXEC_PATH="/realms/${REALM}/authentication/flows/$(urlenc "$FLOW")/executions"

# ---- 1. the copy -----------------------------------------------------------
api POST "/realms/${REALM}/authentication/flows/$(urlenc 'first broker login')/copy" \
    "$(printf '{"newName":"%s"}' "$FLOW")" >/dev/null
case "$API_STATUS" in
  201|204) echo "  created  flow" ;;
  409)     echo "  exists   flow (executions re-checked below)" ;;
  *)       die "copy flow -> HTTP $API_STATUS" ;;
esac

# find <suffix-of-displayName> -> prints the execution JSON, or nothing
find_exec() {
  api GET "$EXEC_PATH" | python3 -c '
import json, sys
want = sys.argv[1]
for e in json.load(sys.stdin):
    if e.get("displayName","").endswith(want):
        print(json.dumps(e)); break
' "$1"
}
find_provider() {
  api GET "$EXEC_PATH" | python3 -c '
import json, sys
for e in json.load(sys.stdin):
    if e.get("providerId") == sys.argv[1]:
        print(json.dumps(e)); break
' "$1"
}
set_requirement() {  # <json> <requirement> <label>
  printf '%s' "$1" | grep -q "\"requirement\": *\"$2\"" && { echo "  ok       $3 already $2"; return; }
  api PUT "$EXEC_PATH" \
      "$(printf '%s' "$1" | python3 -c "import json,sys; e=json.load(sys.stdin); e['requirement']=sys.argv[1]; print(json.dumps(e))" "$2")" >/dev/null
  case "$API_STATUS" in
    200|204) echo "  set      $3 -> $2" ;;
    *)       die "$3 -> HTTP $API_STATUS" ;;
  esac
}

# ---- 2. order: Create User If Unique above Handle Existing Account ----------
# Alternatives are evaluated in index order. Reversed, a reader with no existing
# account is offered the existing-account branch first.
# Compared on POSITION IN THE LISTING, not on the `index` field: index is scoped
# to the level, and two executions at the same level can report indices that do
# not order them against each other the way the flow runs. The listing order is
# the execution order, so that is what has to be compared. Getting this wrong
# made the loop raise repeatedly and then give up silently, leaving the branch
# enabled in the wrong order — the one combination this script exists to avoid.
ordered=0
for _ in 1 2 3 4 5 6 7 8; do
  pos=$(api GET "$EXEC_PATH" | python3 -c '
import json, sys
ex = json.load(sys.stdin)
cu = he = None
for i, e in enumerate(ex):
    d = e.get("displayName", "")
    if d.endswith("Create User If Unique") and cu is None: cu = i
    if d.endswith("Handle Existing Account") and he is None: he = i
print(f"{cu} {he} " + (ex[cu]["id"] if cu is not None else ""))
')
  set -- $pos
  cu=$1; he=$2; cuid=${3:-}
  [ "$cu" != "None" ] && [ "$he" != "None" ] || die "expected executions missing from ${FLOW}"
  if [ "$cu" -lt "$he" ]; then
    ordered=1
    echo "  ok       Create User If Unique precedes Handle Existing Account"
    break
  fi
  api POST "/realms/${REALM}/authentication/executions/${cuid}/raise-priority" "" >/dev/null
  echo "  raised   Create User If Unique"
done
# Never enable the existing-account branch in the wrong order: that sends a
# brand-new reader down it.
[ "$ordered" = 1 ] || die "could not order Create User If Unique above Handle Existing Account — refusing to enable the branch"

# ---- 3. Handle Existing Account -> ALTERNATIVE ------------------------------
set_requirement "$(find_exec 'Handle Existing Account')" ALTERNATIVE "Handle Existing Account"

# ---- 4. re-authentication branch -> DISABLED --------------------------------
# Its only execution is idp-username-password-form. No reader in these realms has
# a password, so the branch can only waste their time.
set_requirement "$(find_exec 'Verify Existing Account by Re-authentication')" DISABLED \
                "Verify Existing Account by Re-authentication"

# ---- 5. remove idp-auto-link ------------------------------------------------
# The important one. As a later ALTERNATIVE it catches whatever confirmation
# rejects, which would make the confirmation decorative.
al=$(find_provider idp-auto-link)
if [ -z "$al" ]; then
  echo "  ok       no idp-auto-link present"
else
  id=$(printf '%s' "$al" | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')
  api DELETE "/realms/${REALM}/authentication/executions/${id}" "" >/dev/null
  case "$API_STATUS" in
    200|204) echo "  removed  Automatically set existing user (idp-auto-link)" ;;
    *)       die "remove idp-auto-link -> HTTP $API_STATUS" ;;
  esac
fi

echo ""
echo "  bind it with:  KC_FIRST_BROKER_LOGIN_FLOW=\"${FLOW}\" ./setup-idp.sh google github"
