import fs from "fs";
import axios from "axios";

/* ============================
   Load History
============================ */
function loadHistory() {
  try {
    const data = fs.readFileSync("data/history.json", "utf-8");
    return JSON.parse(data);
  } catch {
    return [];
  }
}

/* ============================
   Gemini AI (API v1 + model current)
============================ */
async function analyzeWithGemini(history) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return "❌ Gemini API key not configured.";
  }

  const prompt = `
You are a professional lottery analyst.

Analyze this lottery history and provide:
- Hot numbers
- Cold numbers
- Pattern insight
- Short prediction

Data:
${JSON.stringify(history)}
`;

  try {
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-pro:generateContent?key=${apiKey}`,
      {
        contents: [
          {
            parts: [{ text: prompt }]
          }
        ]
      }
    );

    return response.data.candidates?.[0]?.content?.parts?.[0]?.text
      || "No AI response.";

  } catch (error) {
    console.log("Gemini error:");
    console.log(error.response?.data || error.message);
    return "❌ Gemini analysis failed.";
  }
}

/* ============================
   Telegram
============================ */
async function sendToTelegram(message) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  try {
    await axios.post(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        chat_id: chatId,
        text: message
      }
    );
  } catch (err) {
    console.log("Telegram error:", err.response?.data || err.message);
  }
}

/* ============================
   Main
============================ */
async function run() {
  console.log("Starting job...");

  const history = loadHistory();
  const analysis = await analyzeWithGemini(history);

  await sendToTelegram(`🎯 AI Lotto Analysis:\n\n${analysis}`);
}

run();
