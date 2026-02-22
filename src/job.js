import fs from "fs";
import axios from "axios";

/* ================= CONFIG ================= */

const BOT = process.env.TELEGRAM_BOT_TOKEN;
const CHAT = process.env.TELEGRAM_CHAT_ID;

const CSV_PATH = fs.existsSync("data/lotto.csv")
  ? "data/lotto.csv"
  : "data/Lotto.csv";

const KEEP_LAST = 1000;

/* ================= TELEGRAM ================= */

async function sendTelegram(text) {
  await axios.post(
    `https://api.telegram.org/bot${BOT}/sendMessage`,
    {
      chat_id: CHAT,
      text,
      disable_web_page_preview: true
    }
  );
}

/* ================= CSV ================= */

function readCSV() {
  if (!fs.existsSync(CSV_PATH)) return [];
  return fs.readFileSync(CSV_PATH, "utf8")
    .split("\n")
    .filter(Boolean);
}

function trimCSV(lines) {
  const trimmed = lines.slice(0, KEEP_LAST);
  fs.writeFileSync(CSV_PATH, trimmed.join("\n") + "\n");
  return trimmed;
}

/* ================= STATISTICS ================= */

function analyze(lines) {

  const freq = {};
  const strongFreq = {};

  for (let i = 1; i <= 37; i++) freq[i] = 0;
  for (let i = 1; i <= 7; i++) strongFreq[i] = 0;

  for (const line of lines) {
    const parts = line.split(",");
    const nums = parts.slice(1,7).map(Number);
    const strong = Number(parts[7]);

    nums.forEach(n => freq[n]++);
    strongFreq[strong]++;
  }

  const sorted = Object.entries(freq)
    .sort((a,b) => b[1] - a[1]);

  const hot = sorted.slice(0,6).map(x => x[0]);
  const cold = sorted.slice(-6).map(x => x[0]);

  return { freq, strongFreq, hot, cold };
}

/* ================= RECOMMENDATIONS ================= */

function generateRecommendations(freq, strongFreq) {

  const numbers = Object.keys(freq)
    .sort((a,b) => freq[b] - freq[a]);

  const strongSorted = Object.keys(strongFreq)
    .sort((a,b) => strongFreq[b] - strongFreq[a]);

  const lines = [];

  for (let i = 0; i < 8; i++) {

    const chosen = numbers
      .slice(i, i + 12)
      .sort(() => 0.5 - Math.random())
      .slice(0,6)
      .sort((a,b) => a-b);

    const strong = strongSorted[
      Math.floor(Math.random() * strongSorted.length)
    ];

    lines.push(`${chosen.join(", ")} | חזק: ${strong}`);
  }

  return lines;
}

/* ================= MAIN ================= */

async function main() {

  const now = new Date();
  const day = now.getDay(); // 1=Monday, 5=Friday
  const hour = now.getHours();

  if (!( (day === 1 || day === 5) && hour >= 7 && hour <= 12 )) {
    console.log("Not scheduled time.");
    return;
  }

  let lines = readCSV();

  if (lines.length === 0) {
    console.log("CSV empty.");
    return;
  }

  lines = trimCSV(lines);

  const latestDraw = lines[0].split(",")[0];

  const { freq, strongFreq, hot, cold } = analyze(lines);

  const recommendations = generateRecommendations(freq, strongFreq);

  const message =
`📊 לוטו – ניתוח שבועי AI

🎯 הגרלה אחרונה: #${latestDraw}

🔥 חמים:
${hot.join(", ")}

❄ קרים:
${cold.join(", ")}

🧠 מבוסס על ${lines.length} הגרלות אחרונות

🎟 המלצה – 8 שורות:

${recommendations.map((l,i)=>`${i+1}. ${l}`).join("\n")}
`;

  await sendTelegram(message);

  console.log("Weekly analysis sent.");
}

main().catch(err => console.error(err));
