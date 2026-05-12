#!/usr/bin/env bash
# Post a completed evaluation JSON to the deployed Vercel API.
# Usage:
#   EVALUATOR_API_BASE=https://your-app.vercel.app \
#   INGEST_TOKEN=xxx \
#   ./post-evaluation.sh path/to/payload.json
#
# payload.json shape (see SKILL.md):
# {
#   "teamId": "tx",
#   "evaluator": "claude-code",
#   "modelNote": "4 sub-agent + context7 MCP",
#   "scores": [
#     {"criterion":"docs","score":4,"max":5,"rationale":"...","evidence":[{...}]},
#     ...
#   ]
# }

set -euo pipefail

if [[ -z "${EVALUATOR_API_BASE:-}" ]]; then
  echo "EVALUATOR_API_BASE env var required (e.g. https://your-app.vercel.app)" >&2
  exit 2
fi
if [[ -z "${INGEST_TOKEN:-}" ]]; then
  echo "INGEST_TOKEN env var required" >&2
  exit 2
fi
if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <payload.json>" >&2
  exit 2
fi

PAYLOAD="$1"
if [[ ! -f "$PAYLOAD" ]]; then
  echo "payload not found: $PAYLOAD" >&2
  exit 2
fi

curl -fsS -X POST "$EVALUATOR_API_BASE/api/evaluations" \
  -H "Authorization: Bearer $INGEST_TOKEN" \
  -H "Content-Type: application/json" \
  -d @"$PAYLOAD"
echo
