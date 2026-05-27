#!/bin/bash
# Claude Code PreToolUse hook — Mac
# Sends tool request to Telegram via notifier server, waits for Approve/Reject
# Exit 0 = approved, Exit 2 = rejected/timeout (Claude Code blocks the tool)

SERVER_URL="${CLAUDE_NOTIFIER_URL:-http://claude.148.135.138.174.sslip.io}"
TIMEOUT_SECONDS=120
POLL_INTERVAL=2
MACHINE=$(hostname)

# Read JSON from stdin
RAW=$(cat)

TOOL=$(echo "$RAW" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('tool_name','unknown'))" 2>/dev/null || echo "unknown")
INPUT=$(echo "$RAW" | python3 -c "import sys,json; d=json.load(sys.stdin); print(json.dumps(d.get('tool_input',{})))" 2>/dev/null || echo "{}")

BODY=$(python3 -c "
import json, sys
print(json.dumps({
    'tool': sys.argv[1],
    'input': json.loads(sys.argv[2]),
    'machine': sys.argv[3]
}))" "$TOOL" "$INPUT" "$MACHINE" 2>/dev/null)

if [ -z "$BODY" ]; then
    BODY="{\"tool\":\"$TOOL\",\"input\":{},\"machine\":\"$MACHINE\"}"
fi

# Send request to server
RESPONSE=$(curl -s -X POST "$SERVER_URL/request" \
    -H "Content-Type: application/json" \
    -d "$BODY" \
    --max-time 10 2>/dev/null)

ID=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null)

# If server unreachable, approve by default
if [ -z "$ID" ]; then exit 0; fi

# Poll for decision every 2 seconds, up to 120 seconds
ELAPSED=0
while [ "$ELAPSED" -lt "$TIMEOUT_SECONDS" ]; do
    sleep "$POLL_INTERVAL"
    ELAPSED=$((ELAPSED + POLL_INTERVAL))

    STATUS=$(curl -s "$SERVER_URL/decision/$ID" --max-time 5 2>/dev/null | \
        python3 -c "import sys,json; print(json.load(sys.stdin).get('status',''))" 2>/dev/null)

    if [ "$STATUS" = "approved" ]; then
        exit 0
    elif [ "$STATUS" = "rejected" ]; then
        echo "Tool '$TOOL' was rejected via Telegram." >&2
        exit 2
    fi
    # status = "pending" — keep waiting
done

# Timeout — block
echo "No response in ${TIMEOUT_SECONDS}s. Tool '$TOOL' cancelled." >&2
exit 2
