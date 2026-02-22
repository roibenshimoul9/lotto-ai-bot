// src/job.js
import fs from "fs";
import path from "path";
import axios from "axios";
import { computeStats, formatStatsMessage } from "./stats.js";

// ====== ENV ======
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// ====== CONFIG ======
const CSV_PATH = path.join(process.cwd(), "data", "lotto.csv");
const MAX_DRAWS = 1000;     // אתה רוצה 1000
const WINDOW_SIZE = 200;    // "חמים/קרים" עדכני
const MAX_NUMBER = 37;      // לוטו ישראל 1..37

// ====== HELPERS ======
async function sendTelegram(text) {
  if (!BOT_TOKEN || !CHAT_ID) throw new Error("Telegram env not configured");
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  await axios.post(url, {
    chat_id: CHAT_ID,
    text,
    parse_mode: "Markdown",
    disable_web_page_preview: true
  });
}

// CSV פורמט משוער לפי מה שהראית:
// drawNo,date,n1,n2,n3,n4,n5,n6,strong,... (יש אצלך עוד עמודות אבל לא חייבים)
function parseCSV(csvText) {
  const lines = csvText
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean);

  const draws = [];
  for (const line of lines) {
    const parts = line.split(",").map(p => p.trim());
    if (parts.length < 9) continue;

    const drawNo = parts[0];
    const date = parts[1];

    const main = parts.slice(2, 8).map(x => Number(x)).filter(n => Number.isFinite(n));
    const strong = Number(parts[8]);

    if (main.length === 6) {
      draws.push({ drawNo, date, main, strong });
    }
  }

  // חשוב: להפוך ל"מהחדש לישן"
  // אם ה-CSV אצלך מסודר מהחדש לישן כבר — אפשר להשאיר.
  // אם הוא מהישן לחדש — נהפוך:
  // נזהה לפי drawNo: אם עולה כלפי מטה, אז זה ישן->חדש.
  if (draws.length >= 2) {
    const a = Number(draws[0].drawNo);
    const b = Number(draws[1].drawNo);
    if (Number.isFinite(a) && Number.isFinite(b) && b > a) {
      // כנראה ישן -> חדש
      draws.reverse();
    }
  }

  return draws;
}

async function geminiAnalyze(statsObj) {
  if (!GEMINI_API_KEY) return null;

  // Gemini API endpoint (generativelanguage)
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;

  const prompt = `
אתה מנתח סטטיסטי. קיבלת סיכום נתונים של 1000 הגרלות לוטו (מספרים ראשיים בלבד).
מטרות:
1) להסביר בעברית בצורה קצרה וברורה מה המספרים החמים/קרים (לפי כל התקופה ולפי חלון אחרון).
2) לציין מספרים "מפתיעים" לפי z-score (סטייה משמעותית למעלה/למטה).
3) להסביר מה אומר chi-square בצורה פשוטה (לא צריך p-value).
4) להדגיש שזה ניתוח נתונים ולא ניבוי, ולהימנע מהבטחות.

הנה JSON עם הנתונים (אל תדפיס את כולו, רק סיכום):
${JSON.stringify(statsObj, null, 2)}
`;

  const body = {
    contents: [
      {
        role: "user",
        parts: [{ text: prompt }]
      }
    ],
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 500
    }
  };

  const res = await axios.post(url, body, { timeout: 30000 });
  const text = res.data?.candidates?.[0]?.content?.parts?.[0]?.text;
  return text || null;
}

// ====== MAIN ======
async function main() {
  console.log("Starting Lotto AI analysis...");

  // קריאה מה-CSV
  if (!fs.existsSync(CSV_PATH)) {
    await sendTelegram("❌ CSV not found in repo: data/lotto.csv");
    return;
  }

  const csv = fs.readFileSync(CSV_PATH, "utf-8");
  const allDraws = parseCSV(csv);

  const draws = allDraws.slice(0, MAX_DRAWS);
  console.log("Total draws in csv:", allDraws.length);
  console.log("Using draws:", draws.length);

  // סטטיסטיקה
  const stats = computeStats(draws, {
    maxNumber: MAX_NUMBER,
    windowSize: WINDOW_SIZE,
    includePairs: true,
    topPairs: 12
  });

  // הודעה מספרית (ללא AI)
  const baseMsg = formatStatsMessage(stats);

  // AI סיכום
  let aiText = null;
  try {
    aiText = await geminiAnalyze({
      meta: stats.meta,
      highlights: stats.highlights
    });
  } catch (e) {
    console.log("Gemini error:", e?.response?.data || e.message);
  }

  // שולחים לטלגרם
  await sendTelegram(baseMsg);

  if (aiText) {
    await sendTelegram("🤖 *AI Summary:*\n" + aiText);
  } else {
    await sendTelegram("⚠️ AI Summary not available (Gemini error or key missing).");
  }

  console.log("Done.");
}

main().catch(async (err) => {
  console.error(err);
  try {
    await sendTelegram("❌ Script crashed: " + err.message);
  } catch {}
  process.exit(1);
});
