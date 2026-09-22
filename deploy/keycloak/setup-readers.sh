#!/bin/bash
# Provision readers from a list: the user, their identity-provider links and
# their groups. The list is the record of who is invited, so a rebuilt realm
# gets its readers back by running this against it.
#
#   ./setup-readers.sh readers.tsv
#
# One reader per line, tab-separated; blank lines and '#' comments are skipped:
#
#   email  firstName  lastName  groups  links
#
#   groups  comma-separated group names, or '-' for none
#   links   comma-separated provider:userId:userName, or '-' for none
#
# A link is keyed on the id the provider issues (Google's `sub`, GitHub's numeric
# user id), not on the email. A reader whose link exists logs in straight through
# it: the first-broker-login flow, and its confirmation email, never runs. That is
# what lets a GitHub reader with no public address be invited at all: give them
# GitHub's no-reply address (<id>+<login>@users.noreply.github.com) and the link.
#
# Additive only. Missing users, links and memberships are created; nothing is
# removed, and an existing user's name and email are left as they are. Taking a
# reader out of the list does not revoke them, so do that in the admin console.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

LIST="${1:-}"
[ -n "$LIST" ] && [ -f "$LIST" ] || die "usage: $0 <readers.tsv>"

preflight
kc_login

# Readers arrive from a file, so every value goes into JSON through python
# rather than by string interpolation.
jstr() { python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$1"; }
enc()  { python3 -c 'import sys,urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$1"; }

user_id_by_email() {
  api GET "/realms/${REALM}/users?email=$(enc "$1")&exact=true&briefRepresentation=true" \
    | json_get 'd[0]["id"] if d else ""'
}

user_id_by_link() {
  api GET "/realms/${REALM}/users?idpAlias=$(enc "$1")&idpUserId=$(enc "$2")&briefRepresentation=true" \
    | json_get 'd[0]["id"] if d else ""'
}

group_id() {
  api GET "/realms/${REALM}/groups?search=$(enc "$1")&exact=true" \
    | python3 -c "
import sys, json
def walk(gs):
    for g in gs:
        yield g
        yield from walk(g.get('subGroups') or [])
print(next((g['id'] for g in walk(json.load(sys.stdin)) if g['name'] == sys.argv[1]), ''))
" "$1"
}

echo "Readers in ${REALM}"
n=0
while IFS=$'\t' read -r email first last groups links _; do
  case "$email" in ''|'#'*) continue ;; esac
  [ -n "$first" ] && [ -n "$last" ] || die "$email: firstName and lastName are required"
  n=$((n + 1))

  # An existing link wins over the email: the account a reader already logs in
  # to is the one to add to, even if its address has changed since.
  uid=""
  if [ "$links" != "-" ] && [ -n "$links" ]; then
    IFS=',' read -ra L <<<"$links"
    for l in "${L[@]}"; do
      uid=$(user_id_by_link "${l%%:*}" "$(printf '%s' "$l" | cut -d: -f2)")
      [ -n "$uid" ] && break
    done
  fi
  [ -n "$uid" ] || uid=$(user_id_by_email "$email")

  if [ -z "$uid" ]; then
    api POST "/realms/${REALM}/users" "{
      \"username\": $(jstr "$email"), \"email\": $(jstr "$email"),
      \"firstName\": $(jstr "$first"), \"lastName\": $(jstr "$last"),
      \"enabled\": true
    }" >/dev/null
    [ "$API_STATUS" = 201 ] || die "user $email -> HTTP $API_STATUS"
    uid=$(user_id_by_email "$email")
    [ -n "$uid" ] || die "user $email created but not found"
    echo "  created  $email"
  else
    echo "  exists   $email"
  fi

  if [ "$links" != "-" ] && [ -n "$links" ]; then
    IFS=',' read -ra L <<<"$links"
    for l in "${L[@]}"; do
      idp=${l%%:*}; rest=${l#*:}; sub=${rest%%:*}; name=${rest#*:}
      api POST "/realms/${REALM}/users/${uid}/federated-identity/${idp}" "{
        \"identityProvider\": $(jstr "$idp"), \"userId\": $(jstr "$sub"),
        \"userName\": $(jstr "$name")
      }" >/dev/null
      case "$API_STATUS" in
        204) echo "           linked $idp:$name" ;;
        409) ;;  # already linked (to this user or, worse, another — the lookup above prefers the link)
        *)   die "$email: link $idp -> HTTP $API_STATUS" ;;
      esac
    done
  fi

  if [ "$groups" != "-" ] && [ -n "$groups" ]; then
    IFS=',' read -ra G <<<"$groups"
    for g in "${G[@]}"; do
      gid=$(group_id "$g")
      [ -n "$gid" ] || die "$email: group $g does not exist in ${REALM}"
      api PUT "/realms/${REALM}/users/${uid}/groups/${gid}" >/dev/null
      [ "$API_STATUS" = 204 ] || die "$email: group $g -> HTTP $API_STATUS"
    done
    echo "           groups $groups"
  fi
done <"$LIST"
echo "  ${n} reader(s) checked"
