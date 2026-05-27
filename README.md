# Claude Telegram Notifier

Approve or reject Claude Code tool calls directly from Telegram on your phone.

**Flow:**
1. Claude wants to run a tool → `PreToolUse` hook fires
2. Telegram message sent with **Approve ✅** / **Reject ❌** buttons
3. You tap a button → server receives it → hook gets the decision
4. Claude proceeds or cancels
5. No response in 120 seconds → auto-cancelled

Works on both your Windows PC and Mac — same server, same Telegram.

---

## Step 1 — Create a Telegram Bot

1. Open Telegram → search `@BotFather` → send `/newbot`
2. Follow prompts → copy the **Bot Token**
3. Start a chat with your new bot (send any message to it)
4. Get your Chat ID: visit this URL in browser:
   ```
   https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates
   ```
   Find `"chat":{"id": 123456789}` — that number is your Chat ID

---

## Step 2 — Deploy Server to Hostinger VPS

```bash
# Copy the project folder to your VPS, then:
cd claude-telegram-notifier
npm install

cp .env.example .env
nano .env   # Add your bot token and chat ID

# Run with PM2
npm install -g pm2
pm2 start server.js --name claude-notifier
pm2 save
pm2 startup
```

### Test the server

```bash
curl -X POST http://YOUR_VPS_IP:3456/request \
  -H "Content-Type: application/json" \
  -d '{"tool":"Bash","input":{"command":"ls"},"machine":"test"}'
```

You should get a Telegram message with Approve/Reject buttons.

---

## Step 3 — Install Hook on Windows PC

1. Copy `hooks/notify-windows.ps1` → `C:\Users\pc\.claude\hooks\notify-windows.ps1`
2. Open the file — replace `YOUR_VPS_IP` with your actual VPS IP
3. Open `C:\Users\pc\.claude\settings.json` — add the hooks block:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "powershell -File C:\\Users\\pc\\.claude\\hooks\\notify-windows.ps1"
          }
        ]
      }
    ]
  }
}
```

If `settings.json` already has other content, merge the `hooks` key in — don't replace the whole file.

---

## Step 4 — Install Hook on Mac

1. Copy `hooks/notify-mac.sh` → `~/.claude/hooks/notify-mac.sh`
2. Make it executable: `chmod +x ~/.claude/hooks/notify-mac.sh`
3. Open the file — replace `YOUR_VPS_IP` with your VPS IP
4. Open `~/.claude/settings.json` — add the hooks block:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "/Users/YOUR_USERNAME/.claude/hooks/notify-mac.sh"
          }
        ]
      }
    ]
  }
}
```

Replace `YOUR_USERNAME` with your Mac username.

---

## How It Works

- `PreToolUse` hook fires **before every tool call** Claude makes
- Hook sends the tool name + input to your server, then waits (polls every 2s)
- Server sends Telegram message with inline keyboard
- You tap Approve → Claude runs the tool; Reject → Claude cancels it
- No response in **120 seconds** → auto-cancelled, Claude told it was blocked
- If server is unreachable → auto-approved (so Claude isn't stuck offline)

## Files

```
claude-telegram-notifier/
├── server.js                          # Express server (deploy to VPS)
├── package.json
├── .env.example
└── hooks/
    ├── notify-windows.ps1             # Windows hook script
    ├── notify-mac.sh                  # Mac hook script
    ├── settings-snippet-windows.json  # Hook config for Windows ~/.claude/settings.json
    └── settings-snippet-mac.json      # Hook config for Mac ~/.claude/settings.json
```
