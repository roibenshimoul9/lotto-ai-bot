import fs from "fs";
import axios from "axios";

// ==========================
// 📦 קריאת היסטוריה בצורה בטוחה
// ==========================
function loadHistory() {
  try {
    const data = fs.readFileSync("data/history.json", "utf-8");
    return JSON.parse(data);
  } catch (err) {
    console.log("⚠️ No history file found or invalid JSON. Using empty array.");
    return [];
  }
}

// ==========================
// 🤖 Gemini AI
// ==========================
async function analyzeWithGemini(history) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    console.log("❌ Missing GEMINI_API_KEY");
    return "Gemini API key not configured.";
  }

  const prompt = `
אתה אנליסט לוטו מקצועי.

נתח את ההיסטוריה הבאה:
- מצא מספרים חמים
- מצא מספרים קרים
- נתח זוגי/אי זוגי
- נתח פיזור טווחים

החזר תשובה קצרה וברורה.

הנתונים:
${JSON.stringify(history)}
`;

  try {
    const response = await axios.post(
      "https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent",
      {
        contents: [
          { parts: [{ text: prompt }] }
        ]
      },
      {
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey
        }
      }
    );

    return response.data.candidates[0].content.parts[0].text;
  } catch (error) {
    console.log("❌ Gemini Error:", error.response?.data || error.message);
    return "Gemini analysis failed.";
  }
}

// ==========================
// 📲 Telegram
// ==========================
async function sendToTelegram(message) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.log("⚠️ Telegram not configured.");
    return;
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  try {
    await axios.post(url, {
      chat_id: chatId,
      text: message
    });
  } catch (err) {
    console.log("❌ Telegram Error:", err.response?.data || err.message);
  }
}

// ==========================
// 🚀 Run
// ==========================
async function run() {
  console.log("🚀 Starting Lotto AI Job...");

  const history = loadHistory();

  const analysis = await analyzeWithGemini(history);

  console.log("✅ AI Analysis Ready");

  await sendToTelegram(`🎯 AI Lotto Analysis:\n\n${analysis}`);

  console.log("📤 Sent to Telegram");
}

run();
