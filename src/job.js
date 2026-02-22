import axios from "axios";

console.log("Starting job...");

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// -------------------- TELEGRAM --------------------

async function sendTelegramMessage(text) {
  await axios.post(
    `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`,
    {
      chat_id: TELEGRAM_CHAT_ID,
      text: text,
      parse_mode: "Markdown"
    }
  );
}

// -------------------- GEMINI --------------------

async function analyzeWithGemini(history) {
  if (!GEMINI_API_KEY) {
    return "❌ Gemini API key not configured.";
  }

  const prompt = `
You are a professional lottery analyst.

Analyze briefly the following lottery data and give insights in 3-5 short bullet points:

${JSON.stringify(history)}
`;

  try {
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
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
    console.log("========== GEMINI ERROR ==========");
    console.log(error.response?.data || error.message);
    console.log("==================================");
    return "❌ Gemini analysis failed.";
  }
}

// -------------------- MAIN --------------------

async function run() {
  try {
    // דוגמה להיסטוריה (אתה יכול להחליף למה שאתה מושך מה-JSON שלך)
    const history = [
      { main: [10, 15, 29], strong: [1, 2, 5] }
    ];

    const predictionText = `
🎯 *Lotto Prediction*
Main: 10, 15, 29
Strong: 1, 2, 5
`;

    await sendTelegramMessage(predictionText);

    const aiAnalysis = await analyzeWithGemini(history);

    await sendTelegramMessage(`🤖 *AI Lotto Analysis:*\n${aiAnalysis}`);

  } catch (err) {
    console.error(err);
  }
}

run();
