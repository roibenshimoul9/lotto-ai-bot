import axios from "axios";
import fs from "fs";

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// ---------------- TELEGRAM ----------------

async function sendTelegram(text) {
  await axios.post(
    `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`,
    {
      chat_id: TELEGRAM_CHAT_ID,
      text,
    }
  );
}

// ---------------- LOAD LAST 1000 FROM CSV ----------------

function loadLast1000Draws() {
  if (!fs.existsSync("data/Lotto.csv")) {
    throw new Error("Lotto.csv not found");
  }

  const raw = fs.readFileSync("data/Lotto.csv", "utf8");
  const lines = raw.trim().split("\n");

  console.log("Total draws in CSV:", lines.length);

  const last1000 = lines.slice(-1000);

  const parsed = last1000.map(line => {
    const parts = line.split(",");

    return {
      draw: Number(parts[0]),
      date: parts[1],
      main: [
        Number(parts[2]),
        Number(parts[3]),
        Number(parts[4]),
        Number(parts[5]),
        Number(parts[6]),
        Number(parts[7])
      ],
      strong: Number(parts[8])
    };
  });

  return parsed;
}

// ---------------- GEMINI ----------------

async function analyzeWithGemini(data) {

  const prompt = `
You are a professional lottery statistician.

Analyze the following 1000 lottery draws.
Provide short insights about:
- Hot numbers
- Cold numbers
- Even/odd balance
- Any noticeable patterns

Data:
${JSON.stringify(data)}
`;

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
}

// ---------------- MAIN ----------------

async function run() {
  try {
    console.log("Starting Lotto AI analysis...");

    const last1000 = loadLast1000Draws();

    await sendTelegram(
      `📊 Analyzing ${last1000.length} historical draws`
    );

    const aiResult = await analyzeWithGemini(last1000);

    await sendTelegram(
      `🤖 AI Lotto Analysis:\n${aiResult}`
    );

    console.log("Analysis completed.");

  } catch (err) {
    console.error(err.response?.data || err.message);
    await sendTelegram("❌ AI analysis failed.");
  }
}

run();
