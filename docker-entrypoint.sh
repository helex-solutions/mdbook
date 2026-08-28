#!/bin/sh
# Serve the mounted project. Any argument runs that mdbook command instead
# (e.g. `docker run … build` for a one-shot build of the mounted volume).
set -e

if [ "$#" -gt 0 ]; then
  exec mdbook "$@" --project "$MDBOOK_PROJECT"
fi

if [ -n "$MDBOOK_BUILD" ]; then
  mdbook build --project "$MDBOOK_PROJECT"
fi

exec mdbook serve --project "$MDBOOK_PROJECT" --port "$MDBOOK_PORT" --host 0.0.0.0
