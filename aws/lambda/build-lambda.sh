#!/bin/bash
# Assemble the deployable Lambda asset: handler + shared client + config + deps.
# pywebpush pulls in native packages (cryptography, cffi), so deps are installed
# INSIDE the AWS SAM python3.12 image for linux/amd64 — the compiled wheels then
# match the Lambda x86_64 runtime. Requires Docker. Run before `cdk deploy`.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
BUILD="$HERE/build"

rm -rf "$BUILD"; mkdir -p "$BUILD"
docker run --rm --platform linux/amd64 \
  -v "$HERE/requirements.txt":/req.txt:ro -v "$BUILD":/out \
  public.ecr.aws/sam/build-python3.12 \
  pip install -r /req.txt -t /out --quiet --root-user-action=ignore
cp "$HERE/handler.py" "$HERE/push.py" "$HERE/notify_filter.py" "$ROOT/lagoon_client.py" "$ROOT/courses.json" "$BUILD/"
echo "Built Lambda asset at $BUILD:"; ls "$BUILD"
