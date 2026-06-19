#!/bin/bash
# Assemble the deployable Lambda asset: handler + shared client + config + tzdata.
# tzdata is pure-Python, so a local pip install is portable to the Lambda runtime
# (no Docker needed). Run before `cdk deploy`.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
BUILD="$HERE/build"
PYTHON="${LAGOON_PYTHON:-/opt/homebrew/bin/python3}"

rm -rf "$BUILD"; mkdir -p "$BUILD"
"$PYTHON" -m pip install -r "$HERE/requirements.txt" -t "$BUILD" --quiet
cp "$HERE/handler.py" "$ROOT/lagoon_client.py" "$ROOT/courses.json" "$BUILD/"
echo "Built Lambda asset at $BUILD:"; ls "$BUILD"
