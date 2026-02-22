import fs from "fs";

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const CSV_PATH = "data/lotto.csv";
const MAIN_MIN = 1;
const MAIN_MAX = 37;

function parseCsv(text) {
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  const rows = [];

  for (const line of lines) {
    const parts = line.split(",");
    if (parts.length < 9) continue;

    const draw = {
      drawNo: Number(parts[0]),
      date: parts[1],
      nums: parts.slice(2, 8).map(n => Number(n)),
      strong: Number(parts[8])
    };

    if (!draw.drawNo) continue;
    rows.push(draw);
  }

  rows.sort((a, b) => a.drawNo - b.drawNo);
  return rows;
}

function initFreq() {
  const f = {};
  for (let i = MAIN_MIN; i <= MAIN_MAX; i++) f[i] = 0;
  return f;
}

function computeStats(rows) {
  const freq = initFreq();
  let even = 0;
  let odd = 0;

  for (const r of rows) {
    for (const n of r.nums) {
      freq[n]++;
      if (n % 2 === 0) even++;
      else odd++;
    }
  }

  const total = rows.length * 6;

  const arr = Object.entries(freq).map(([n, c]) => ({
    num: Number(n),
    count: c,
    rel: total ? c / total : 0
  }));

  arr.sort((a, b) => b.count - a.count);

  return {
    freq,
    top: arr.slice(0, 5),
    cold: arr.slice(-5),
    evenPct: total ? even / total : 0,
    oddPct: total ? odd / total : 0,
    total
  };
}

function compare(stats100, stats999) {
  const deltas = [];

  for (let i = MAIN_MIN; i <= MAIN_MAX; i++) {
    const r100 = stats100.freq[i] / stats100.total;
    const r999 = stats999.freq[i] / stats999.total;
    deltas.push({ num: i, delta: r100 - r999 });
  }

  deltas.sort((a, b) => b.delta - a.delta);

  return {
    risers: deltas.slice(0, 5),
    fallers: deltas.slice(-5)
  };
}

async function sendTelegram(text) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text,
      disable_web_page_preview: true
    })
  });
}

async function geminiSummary(data) {
  if (!GEMINI_API_KEY) {
    console.log("❌ GEMINI_API_KEY missing");
    return null;
  }

  console.log("🔵 Calling Gemini...");

  const prompt = `
בצע ניתוח סטטיסטי מקצועי על נתוני לוטו.
השווה בין 100 ההגרלות האחרונות לבין 999 האחרונות.
זהה שינויי מגמה, התחממות/התקררות מספרים ואיזון זוגי/אי זוגי.
החזר 3-4 שורות בעברית בלבד, חדות ואליטיסטיות.
נתונים:
${JSON.stringify(data)}
`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 200 }
      })
    }
  );

  const json = await res.json();
  const text =
    json?.candidates?.[0]?.content?.parts?.map(p => p.text).join("\n") || null;

  console.log("🟢 Gemini response:", text);

  return text;
}

async function main() {
  console.log("Starting Lotto AI analysis (100 vs 999) ...");

  const csv = fs.readFileSync(CSV_PATH, "utf8");
  const rows = parseCsv(csv);

  const last999 = rows.slice(-999);
  const last100 = rows.slice(-100);

  const stats999 = computeStats(last999);
  const stats100 = computeStats(last100);

  const cmp = compare(stats100, stats999);

  const baseMessage = `
📊 Lotto Analysis

🔥 100 אחרונות חמות: ${stats100.top.map(x => x.num).join(", ")}
❄️ 100 אחרונות קרות: ${stats100.cold.map(x => x.num).join(", ")}

📈 שינויי מגמה:
⬆️ התחממו: ${cmp.risers.map(x => x.num).join(", ")}
⬇️ התקררו: ${cmp.fallers.map(x => x.num).join(", ")}
`;

  const aiText = await geminiSummary({
    stats100,
    stats999,
    cmp
  });

  let finalMessage = baseMessage;

  if (aiText && aiText.trim().length > 0) {
    finalMessage += `\n🧠 ניתוח AI (Gemini 2.5 Flash)\n${aiText.trim()}`;
  } else {
    finalMessage += `\n🧠 ניתוח AI\nלא התקבל פלט מ-Gemini.`;
  }

  await sendTelegram(finalMessage);

  console.log("Done. Sent Telegram message.");
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
