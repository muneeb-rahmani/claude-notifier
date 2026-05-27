# Claude Code PreToolUse hook — Windows
# Sends tool request to Telegram via notifier server, waits for Approve/Reject
# Exit 0 = approved, Exit 2 = rejected/timeout (Claude Code blocks the tool)

param()

$SERVER_URL = $env:CLAUDE_NOTIFIER_URL
if (-not $SERVER_URL) { $SERVER_URL = "http://claude.148.135.138.174.sslip.io" }

$TIMEOUT_SECONDS = 120
$POLL_INTERVAL = 2

# Read JSON from stdin
$raw = $input | Out-String
try { $parsed = $raw | ConvertFrom-Json } catch { $parsed = @{} }

$tool    = if ($parsed.tool_name)  { $parsed.tool_name }  else { "unknown" }
$inputData = if ($parsed.tool_input) { $parsed.tool_input } else { $null }
$machine = $env:COMPUTERNAME

# Convert tool_input to hashtable for JSON body
$inputHash = @{}
if ($inputData) {
    $inputData.PSObject.Properties | ForEach-Object { $inputHash[$_.Name] = $_.Value }
}

$body = @{
    tool    = $tool
    input   = $inputHash
    machine = $machine
} | ConvertTo-Json -Depth 5

# Send request to server
try {
    $response = Invoke-RestMethod -Uri "$SERVER_URL/request" `
        -Method Post `
        -ContentType "application/json" `
        -Body $body `
        -TimeoutSec 10
} catch {
    # If server is unreachable, approve by default so Claude isn't stuck
    exit 0
}

$id = $response.id
if (-not $id) { exit 0 }

# Poll for decision every 2 seconds, up to 120 seconds
$elapsed = 0
while ($elapsed -lt $TIMEOUT_SECONDS) {
    Start-Sleep -Seconds $POLL_INTERVAL
    $elapsed += $POLL_INTERVAL

    try {
        $decision = Invoke-RestMethod -Uri "$SERVER_URL/decision/$id" `
            -Method Get `
            -TimeoutSec 5
    } catch {
        continue
    }

    if ($decision.status -eq "approved") {
        exit 0
    } elseif ($decision.status -eq "rejected") {
        Write-Error "Tool '$tool' was rejected via Telegram."
        exit 2
    }
    # status = "pending" — keep waiting
}

# Timeout reached — block
Write-Error "No response in ${TIMEOUT_SECONDS}s. Tool '$tool' cancelled."
exit 2
