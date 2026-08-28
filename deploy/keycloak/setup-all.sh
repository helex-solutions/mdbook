#!/bin/bash
# Realm + identity providers in one go.
#   ./setup-all.sh                 # realm only
#   ./setup-all.sh --with-idp google
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

"${SCRIPT_DIR}/setup-realm.sh"

IDPS=""
while [ $# -gt 0 ]; do
  case "$1" in
    --with-idp) shift; IDPS="$*"; break ;;
    *) shift ;;
  esac
done
if [ -n "$IDPS" ]; then
  echo ""
  # shellcheck disable=SC2086
  "${SCRIPT_DIR}/setup-idp.sh" $IDPS
fi
