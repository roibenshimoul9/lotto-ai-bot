import fs from "fs";
import axios from "axios";

/* ============================
   Load History
============================ */
function loadHistory() {
  try {
    const data = fs.readFileSync("data/history.json", "utf-8");
    return JSON.parse(data);
  } catch (err) {
    console.log("History load error:", err.message);
    return [];
  }
}

/* ============================
   Gemini AI
============================ */
async function analyzeWithGemini(history) {
  const apiKey = process.env.GEMINI_API_KEY;

  console.log("Gemini key exists?", !!apiKey);

  if (!apiKey) {
    return "❌ Gemini API key not configured.";
  }

  const prompt = `
You are a professional lottery analyst.
Analyze the data briefly.

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

    console.log("Gemini success");

    return response.data.candidates?.[0]?.content?.parts?.[0]?.text
      || "No AI response.";

  } catch (error) {

    console.log("========== GEMINI ERROR ==========");
    console.log(error.response?.status);
    console.log(JSON.stringify(error.response?.data, null, 2));
    console.log("==================================");

    return "❌ Gemini failed. Check GitHub logs.";
  }
}

/* ============================
   Telegram
============================ */
async function sendToTelegram(message) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  try {
    await axios.post(url, {
      chat_id: chatId,
      text: message
    });
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

  await sendToTelegram(`AI Lotto Analysis:\n\n${analysis}`);
}

run();
