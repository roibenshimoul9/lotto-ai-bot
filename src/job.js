import fs from "fs";
import axios from "axios";
import { חשבסטטיסטיקה, פורמטלהודעה } from "./stats.js";

const BOT = process.env.TELEGRAM_BOT_TOKEN;
const CHAT = process.env.TELEGRAM_CHAT_ID;
const GEMINI = process.env.GEMINI_API_KEY;

const CSV_PATH = "data/Lotto.csv";
const כמותהגרלות = 1000;

async function שלח(טקסט) {
  await axios.post(`https://api.telegram.org/bot${BOT}/sendMessage`, {
    chat_id: CHAT,
    text: טקסט
  });
}

function פרסCSV(csv) {
  const שורות = csv.split(/\r?\n/).filter(Boolean);
  const תוצאה = [];

  for (const שורה of שורות) {
    const חלקים = שורה.split(",");
    if (חלקים.length < 8) continue;

    const ראשיים = חלקים.slice(2,8).map(Number);
    תוצאה.push({ main: ראשיים });
  }

  return תוצאה.reverse();
}

async function ניתוחAI(נתונים) {
  if (!GEMINI) return null;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI}`;

  const פרומפט = `
אתה אנליסט סטטיסטי.
קיבלת נתונים של 1000 הגרלות לוטו.
תן ניתוח קצר וברור בעברית:
- מה המספרים החמים?
- מה הקרים?
- מה המשמעות של chi-square?
- הדגש שזה לא מבטיח זכייה.

נתונים:
${JSON.stringify(נתונים)}
`;

  const גוף = {
    contents: [{ role: "user", parts: [{ text: פרומפט }] }]
  };

  const תשובה = await axios.post(url, גוף);
  return תשובה.data?.candidates?.[0]?.content?.parts?.[0]?.text;
}

async function main() {

  const csv = fs.readFileSync(CSV_PATH,"utf8");
  const הגרלות = פרסCSV(csv).slice(0, כמותהגרלות);

  const נתונים = חשבסטטיסטיקה(הגרלות);

  await שלח(פורמטלהודעה(נתונים));

  const ai = await ניתוחAI(נתונים);
  if (ai) await שלח("🤖 ניתוח AI:\n\n"+ai);
}

main();
