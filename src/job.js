import fs from "fs";
import axios from "axios";

/* ================= CONFIG ================= */

const BOT = process.env.TELEGRAM_BOT_TOKEN;
const CHAT = process.env.TELEGRAM_CHAT_ID;
const GEMINI = process.env.GEMINI_API_KEY;

const CSV_PATH = "data/lotto.csv";
const MAX_NUMBER = 37;
const MAX_STRONG = 7;
const LAST_N = 1000;

/* ================= TELEGRAM ================= */

async function send(text) {
  await axios.post(`https://api.telegram.org/bot${BOT}/sendMessage`, {
    chat_id: CHAT,
    text,
    disable_web_page_preview: true
  });
}

/* ================= PARSE CSV ================= */

function parseCSV(csv) {
  const lines = csv.split(/\r?\n/).filter(Boolean);
  const draws = [];

  for (const line of lines) {
    const p = line.split(",");
    if (p.length < 8) continue;

    const main = p.slice(2, 8).map(Number);
    const strong = Number(p[8]);

    if (main.length === 6) {
      draws.push({ main, strong });
    }
  }

  return draws.reverse().slice(0, LAST_N);
}

/* ================= STATS ================= */

function computeStats(draws) {

  const freq = Array(MAX_NUMBER + 1).fill(0);

  for (let d of draws) {
    for (let n of d.main) freq[n]++;
  }

  const p = 6 / MAX_NUMBER;
  const expected = draws.length * p;
  const sd = Math.sqrt(draws.length * p * (1 - p));

  const numbers = [];

  for (let i = 1; i <= MAX_NUMBER; i++) {
    numbers.push({
      num: i,
      freq: freq[i],
      z: sd > 0 ? (freq[i] - expected) / sd : 0
    });
  }

  const hot = [...numbers].sort((a,b)=>b.freq-a.freq).slice(0,8);
  const cold = [...numbers].sort((a,b)=>a.freq-b.freq).slice(0,8);

  return { hot, cold };
}

/* ================= GENERATE 8 LINES ================= */

function generateLines(stats) {

  const lines = [];

  function balancedLine(pool) {

    const set = new Set();

    while (set.size < 6) {
      const n = pool[Math.floor(Math.random() * pool.length)];
      set.add(n);
    }

    const arr = [...set];

    const evens = arr.filter(n=>n%2===0).length;
    const lows = arr.filter(n=>n<=18).length;

    if (evens < 2 || evens > 4) return balancedLine(pool);
    if (lows < 2 || lows > 4) return balancedLine(pool);

    return arr.sort((a,b)=>a-b);
  }

  const pool = [
    ...stats.hot.map(x=>x.num),
    ...stats.cold.map(x=>x.num)
  ];

  for (let i = 0; i < 8; i++) {

    const nums = balancedLine(pool);
    const strong = Math.floor(Math.random()*MAX_STRONG)+1;

    lines.push({ nums, strong });
  }

  return lines;
}

/* ================= GEMINI ================= */

async function aiAnalysis(stats) {

  if (!GEMINI) return null;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI}`;

  const prompt = `
אתה אנליסט סטטיסטי בכיר.

בהתבסס על הנתונים:
חמים: ${stats.hot.map(x=>x.num).join(", ")}
קרים: ${stats.cold.map(x=>x.num).join(", ")}

כתוב ניתוח אליטי תמציתי (3-5 שורות בלבד):
- האם קיימת ריכוזיות?
- האם יש סטייה מהתפלגות אקראית?
- מה המשמעות הסטטיסטית?
- הדגש שמדובר בניתוח ולא הבטחת זכייה.
`;

  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }]
  };

  const res = await axios.post(url, body);
  return res.data?.candidates?.[0]?.content?.parts?.[0]?.text;
}

/* ================= FORMAT MESSAGE ================= */

function formatMessage(stats, lines, aiText) {

  let msg = "📊 ניתוח שבועי – לוטו ישראל\n\n";

  msg += "🔥 חמים:\n";
  msg += stats.hot.map(x=>`${x.num} (${x.freq})`).join(", ") + "\n\n";

  msg += "🧊 קרים:\n";
  msg += stats.cold.map(x=>`${x.num} (${x.freq})`).join(", ") + "\n\n";

  if (aiText) {
    msg += "🧠 ניתוח AI:\n" + aiText + "\n\n";
  }

  msg += "🎟 טופס מומלץ (8 שורות):\n\n";

  lines.forEach((l,i)=>{
    msg += `שורה ${i+1}: ${l.nums.join(", ")} | חזק: ${l.strong}\n`;
  });

  msg += "\n⚠️ הלוטו הוא משחק אקראי ואין בכך הבטחת זכייה.";

  return msg;
}

/* ================= MAIN ================= */

async function main() {

  const csv = fs.readFileSync(CSV_PATH,"utf8");
  const draws = parseCSV(csv);

  const stats = computeStats(draws);
  const lines = generateLines(stats);
  const aiText = await aiAnalysis(stats);

  const message = formatMessage(stats, lines, aiText);

  await send(message);
}

main().catch(err=>{
  console.error(err);
});
