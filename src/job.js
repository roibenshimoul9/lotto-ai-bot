import fs from "fs";
import axios from "axios";

/* ================= CONFIG ================= */

const BOT = process.env.TELEGRAM_BOT_TOKEN;
const CHAT = process.env.TELEGRAM_CHAT_ID;
const GEMINI = process.env.GEMINI_API_KEY;

const CSV_PATH = "data/lotto.csv";
const MAX_NUMBER = 37;
const MAX_STRONG = 7;
const KEEP_LAST = 1000;

/* ================= TELEGRAM ================= */

async function send(text) {
  await axios.post(`https://api.telegram.org/bot${BOT}/sendMessage`, {
    chat_id: CHAT,
    text,
    disable_web_page_preview: true
  });
}

/* ================= UPDATE LATEST DRAW ================= */

async function updateWithLatestDraw() {
  try {
    console.log("Checking latest draw...");

    const url = "https://www.pais.co.il/api/lotto/getLastResults";
    const res = await axios.get(url);
    const latest = res.data?.results?.[0];

    if (!latest) return;

    const drawId = latest.drawNumber;
    const date = latest.drawDate;
    const main = latest.regularNumbers;
    const strong = latest.strongNumber;

    if (!main || main.length !== 6) return;

    let existing = "";
    if (fs.existsSync(CSV_PATH)) {
      existing = fs.readFileSync(CSV_PATH, "utf8");
    }

    if (existing.includes(drawId)) {
      console.log("Draw already exists.");
      return;
    }

    const newLine =
      `${drawId},${date},${main.join(",")},${strong}\n`;

    const combined = newLine + existing;
    const lines = combined.split("\n").filter(Boolean).slice(0, KEEP_LAST);

    fs.writeFileSync(CSV_PATH, lines.join("\n") + "\n");

    console.log("Latest draw added.");

  } catch (err) {
    console.log("Update failed. Using existing CSV.");
  }
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

  return draws.slice(0, KEEP_LAST);
}

/* ================= STATS ================= */

function computeStats(draws) {

  const freq = Array(MAX_NUMBER + 1).fill(0);

  for (let d of draws)
    for (let n of d.main)
      freq[n]++;

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
  const pool = [
    ...stats.hot.map(x=>x.num),
    ...stats.cold.map(x=>x.num)
  ];

  function balanced() {
    const set = new Set();

    while (set.size < 6)
      set.add(pool[Math.floor(Math.random()*pool.length)]);

    const arr = [...set];

    const evens = arr.filter(n=>n%2===0).length;
    const lows = arr.filter(n=>n<=18).length;

    if (evens < 2 || evens > 4) return balanced();
    if (lows < 2 || lows > 4) return balanced();

    return arr.sort((a,b)=>a-b);
  }

  for (let i=0;i<8;i++) {
    lines.push({
      nums: balanced(),
      strong: Math.floor(Math.random()*MAX_STRONG)+1
    });
  }

  return lines;
}

/* ================= GEMINI ================= */

async function aiAnalysis(stats) {

  if (!GEMINI) return null;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI}`;

  const prompt = `
אתה אנליסט סטטיסטי בכיר.

חמים: ${stats.hot.map(x=>x.num).join(", ")}
קרים: ${stats.cold.map(x=>x.num).join(", ")}

כתוב ניתוח אליטי תמציתי 3-5 שורות בלבד.
הדגש שזה ניתוח נתונים ולא הבטחת זכייה.
`;

  const res = await axios.post(url, {
    contents: [{ role: "user", parts: [{ text: prompt }] }]
  });

  return res.data?.candidates?.[0]?.content?.parts?.[0]?.text;
}

/* ================= FORMAT ================= */

function format(stats, lines, aiText) {

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

  await updateWithLatestDraw();

  const csv = fs.readFileSync(CSV_PATH,"utf8");
  const draws = parseCSV(csv);

  const stats = computeStats(draws);
  const lines = generateLines(stats);
  const aiText = await aiAnalysis(stats);

  const message = format(stats, lines, aiText);

  await send(message);
}

main().catch(console.error);
