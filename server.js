import express from "express";
import fetch from "node-fetch";
import crypto from "crypto";
import "dotenv/config";

const app = express();
app.use(express.json());

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const PORT = process.env.PORT || 3456;

if (!BOT_TOKEN || !CHAT_ID) {
  console.error("Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID in .env");
  process.exit(1);
}

// In-memory store: { [id]: { status: 'pending'|'approved'|'rejected', createdAt } }
const requests = new Map();

// Clean up old entries every 5 minutes
setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [id, req] of requests) {
    if (req.createdAt < cutoff) requests.delete(id);
  }
}, 5 * 60 * 1000);

async function sendTelegram(method, body) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

// Hook calls this — creates a pending request and sends Telegram message
app.post("/request", async (req, res) => {
  const { tool, input, machine } = req.body;
  const id = crypto.randomBytes(8).toString("hex");

  requests.set(id, { status: "pending", createdAt: Date.now() });

  // Format the input preview (trim long values)
  let inputPreview = "";
  if (input && typeof input === "object") {
    const lines = Object.entries(input)
      .map(([k, v]) => {
        const val = String(v).slice(0, 120);
        return `  <code>${k}</code>: ${val}`;
      })
      .slice(0, 5);
    inputPreview = "\n" + lines.join("\n");
  } else if (input) {
    inputPreview = `\n  <code>${String(input).slice(0, 200)}</code>`;
  }

  const text =
    `🔔 <b>Claude needs approval</b>\n\n` +
    `🖥 <b>Machine:</b> <code>${machine || "unknown"}</code>\n` +
    `🔧 <b>Tool:</b> <code>${tool || "unknown"}</code>\n` +
    (inputPreview ? `📋 <b>Input:</b>${inputPreview}\n` : "") +
    `\n⏳ Auto-cancels in 120 seconds`;

  try {
    await sendTelegram("sendMessage", {
      chat_id: CHAT_ID,
      text,
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "✅ Approve", callback_data: `approve:${id}` },
            { text: "❌ Reject", callback_data: `reject:${id}` },
          ],
        ],
      },
    });
    res.json({ ok: true, id });
  } catch (err) {
    // If Telegram fails, auto-approve so Claude isn't stuck forever
    requests.set(id, { status: "approved", createdAt: Date.now() });
    console.error("Telegram send failed:", err.message);
    res.json({ ok: false, id, error: err.message });
  }
});

// Hook polls this every 2 seconds
app.get("/decision/:id", (req, res) => {
  const entry = requests.get(req.params.id);
  if (!entry) return res.status(404).json({ status: "not_found" });
  res.json({ status: entry.status });
});

app.get("/", (_req, res) => res.json({ ok: true }));
app.get("/health", (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Claude Telegram Notifier running on port ${PORT}`);
  startPolling();
});

// Long polling — no HTTPS/domain needed
async function processUpdate(update) {
  const query = update.callback_query;
  if (!query) return;

  const [action, id] = (query.data || "").split(":");
  const entry = requests.get(id);

  if (!entry) {
    await sendTelegram("answerCallbackQuery", {
      callback_query_id: query.id,
      text: "Request expired or not found.",
    });
    return;
  }

  if (entry.status !== "pending") {
    await sendTelegram("answerCallbackQuery", {
      callback_query_id: query.id,
      text: "Already decided.",
    });
    return;
  }

  const decision = action === "approve" ? "approved" : "rejected";
  requests.set(id, { ...entry, status: decision });

  const emoji = decision === "approved" ? "✅" : "❌";
  const label = decision === "approved" ? "Approved" : "Rejected";

  await sendTelegram("editMessageReplyMarkup", {
    chat_id: query.message.chat.id,
    message_id: query.message.message_id,
    reply_markup: { inline_keyboard: [] },
  });

  await sendTelegram("answerCallbackQuery", {
    callback_query_id: query.id,
    text: `${emoji} ${label}`,
  });
}

async function startPolling() {
  // Clear any existing webhook so polling works
  await sendTelegram("deleteWebhook", {}).catch(() => {});

  let offset = 0;
  console.log("Telegram long polling started");

  while (true) {
    try {
      const data = await sendTelegram("getUpdates", {
        offset,
        timeout: 30,
        allowed_updates: ["callback_query"],
      });

      if (data.ok && data.result.length > 0) {
        for (const update of data.result) {
          offset = update.update_id + 1;
          processUpdate(update).catch(console.error);
        }
      }
    } catch (err) {
      console.error("Polling error:", err.message);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}
