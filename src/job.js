import fs from "fs";
import axios from "axios";

/* ============================
   📦 Load History Safely
============================ */
function loadHistory() {
  try {
    const data = fs.readFileSync("data/history.json", "utf-8");
    return JSON.parse(data);
  } catch (err) {
    console.log("⚠️ No history file found or invalid JSON. Using empty array.");
    return [];
  }
}

/* ============================
   🤖 Gemini AI Analysis
============================ */
async function analyzeWithGemini(history) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return "❌ Gemini API key not configured.";
  }

  const prompt = `
You are a professional lottery data analyst.

Analyze this lottery history.
Provide:
- Hot numbers
- Cold numbers
- Pattern insights
- Short prediction

Return a short clear response.

Data:
${JSON.stringify(history)}
`;

  try {
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      {
        contents: [
          {
            parts: [{ text: prompt }]
          }
        ]
      }
    );

    return response.data.candidates?.[0]?.content?.parts?.[0]?.text
      || "No AI response received.";

  } catch (error) {
    console.log("❌ Gemini Error:");
    console.log(error.response?.data || error.message);

    return "❌ Gemini analysis failed.";
  }
}

/* ============================
   📲 Telegram Sender
============================ */
async function sendToTelegram(message) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.log("⚠️ Telegram secrets missing.");
    return;
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  try {
    await axios.post(url, {
      chat_id: chatId,
      text: message
    });

  } catch (err) {
    console.log("❌ Telegram Error:");
    console.log(err.response?.data || err.message);
  }
}

/* ============================
   🚀 Main Runner
============================ */
async function run() {
  console.log("🚀 Lotto AI Job Started...");

  const history = loadHistory();

  const analysis = await analyzeWithGemini(history);

  console.log("✅ Analysis complete.");

  await sendToTelegram(`🎯 AI Lotto Analysis:\n\n${analysis}`);

  console.log("📤 Sent to Telegram.");
}

run();
