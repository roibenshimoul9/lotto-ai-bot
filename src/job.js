// src/job.js
import fs from "fs";
import path from "path";

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// ====== CONFIG ======
const CSV_PATH_CANDIDATES = [
  path.join("data", "lotto.csv"),
  "lotto.csv",
  path.join("data", "Lotto.csv"),
  "Lotto.csv",
];

const MAIN_MIN = 1;
const MAIN_MAX = 37;   // לוטו ישראלי בדרך כלל 1-37
const STRONG_MIN = 1;
const STRONG_MAX = 7;  // "מספר חזק" 1-7

const WINDOW_LONG = 999;
const WINDOW_SHORT = 100;

// ====== HELPERS ======
function findCsvPath() {
  for (const p of CSV_PATH_CANDIDATES) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function safeInt(x) {
  const n = Number(String(x).trim());
  return Number.isFinite(n) ? n : null;
}

/**
 * ציפייה לשורה בפורמט (לפי מה שהראית):
 * drawNo,date,n1,n2,n3,n4,n5,n6,strong,...
 */
function parseCsvRows(csvText) {
  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const rows = [];
  for (const line of lines) {
    const parts = line.split(",").map((p) => p.trim());
    if (parts.length < 9) continue;

    const drawNo = safeInt(parts[0]);
    const dateStr = parts[1] || "";
    const nums = parts.slice(2, 8).map(safeInt);
    const strong = safeInt(parts[8]);

    if (!drawNo || nums.some((n) => n == null) || strong == null) continue;

    // סינון טווחים בסיסי
    const inMainRange = nums.every((n) => n >= MAIN_MIN && n <= MAIN_MAX);
    const inStrongRange = strong >= STRONG_MIN && strong <= STRONG_MAX;
    if (!inMainRange || !inStrongRange) continue;

    rows.push({ drawNo, dateStr, nums, strong });
  }

  // מיון לפי מספר הגרלה עולה (ליתר ביטחון), ואז ניקח את האחרונים
  rows.sort((a, b) => a.drawNo - b.drawNo);
  return rows;
}

function initFreq(min, max) {
  const obj = {};
  for (let i = min; i <= max; i++) obj[i] = 0;
  return obj;
}

function computeStats(rowsWindow) {
  const mainFreq = initFreq(MAIN_MIN, MAIN_MAX);
  const strongFreq = initFreq(STRONG_MIN, STRONG_MAX);

  let even = 0;
  let odd = 0;

  // buckets ("עשירונים" / טווחים)
  // 1-10, 11-20, 21-30, 31-37
  const buckets = [
    { name: "1-10", min: 1, max: 10, count: 0 },
    { name: "11-20", min: 11, max: 20, count: 0 },
    { name: "21-30", min: 21, max: 30, count: 0 },
    { name: "31-37", min: 31, max: 37, count: 0 },
  ];

  for (const r of rowsWindow) {
    for (const n of r.nums) {
      mainFreq[n] += 1;
      if (n % 2 === 0) even += 1;
      else odd += 1;

      for (const b of buckets) {
        if (n >= b.min && n <= b.max) {
          b.count += 1;
          break;
        }
      }
    }
    strongFreq[r.strong] += 1;
  }

  const totalDraws = rowsWindow.length;
  const totalMainPicks = totalDraws * 6;

  function topBottom(freqObj, k = 5) {
    const arr = Object.entries(freqObj).map(([num, c]) => ({ num: Number(num), c }));
    arr.sort((a, b) => b.c - a.c || a.num - b.num);
    const top = arr.slice(0, k);
    const bottom = arr.slice(-k).sort((a, b) => a.c - b.c || a.num - b.num);
    return { top, bottom, all: arr };
  }

  const mainTB = topBottom(mainFreq, 7);
  const strongTB = topBottom(strongFreq, 3);

  const bucketSummary = buckets.map((b) => ({
    name: b.name,
    count: b.count,
    pct: totalMainPicks ? (b.count / totalMainPicks) : 0,
  }));

  return {
    totalDraws,
    totalMainPicks,
    mainFreq,
    strongFreq,
    mainTop: mainTB.top,
    mainCold: mainTB.bottom,
    strongTop: strongTB.top,
    strongCold: strongTB.bottom,
    even,
    odd,
    evenPct: totalMainPicks ? even / totalMainPicks : 0,
    oddPct: totalMainPicks ? odd / totalMainPicks : 0,
    buckets: bucketSummary,
    lastDraw: rowsWindow[rowsWindow.length - 1] || null,
  };
}

function compareWindows(stats100, stats999) {
  // השוואת תדירויות יחסיות (frequency / totalMainPicks)
  const rel100 = {};
  const rel999 = {};
  for (let i = MAIN_MIN; i <= MAIN_MAX; i++) {
    rel100[i] = stats100.totalMainPicks ? stats100.mainFreq[i] / stats100.totalMainPicks : 0;
    rel999[i] = stats999.totalMainPicks ? stats999.mainFreq[i] / stats999.totalMainPicks : 0;
  }

  const deltas = [];
  for (let i = MAIN_MIN; i <= MAIN_MAX; i++) {
    deltas.push({
      num: i,
      delta: rel100[i] - rel999[i], // חיובי = חם יותר ב-100 האחרונים
      r100: rel100[i],
      r999: rel999[i],
      c100: stats100.mainFreq[i],
      c999: stats999.mainFreq[i],
    });
  }

  deltas.sort((a, b) => b.delta - a.delta);
  const risers = deltas.slice(0, 7); // "עולים"
  const fallers = [...deltas].reverse().slice(0, 7); // "יורדים"

  return { risers, fallers };
}

function formatTopList(list, maxItems = 5) {
  return list
    .slice(0, maxItems)
    .map((x) => `${x.num}(${x.c})`)
    .join(", ");
}

function formatBuckets(buckets) {
  // דוגמה: 1-10: 26% | 11-20: 24% ...
  return buckets
    .map((b) => `${b.name}: ${(b.pct * 100).toFixed(1)}%`)
    .join(" | ");
}

async function sendTelegram(text) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.log("Telegram not configured (missing TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID).");
    return;
  }

  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const payload = {
    chat_id: TELEGRAM_CHAT_ID,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Telegram send failed: ${res.status} ${t}`);
  }
}

async function geminiSummary({ stats100, stats999, cmp }) {
  if (!GEMINI_API_KEY) return null;

  // יוצרים “תמצית נתונים” קצרה שה-AI יוכל להסיק ממנה
  const dataBrief = {
    draws_100: stats100.totalDraws,
    draws_999: stats999.totalDraws,
    hot_100: stats100.mainTop.slice(0, 5),
    cold_100: stats100.mainCold.slice(0, 5),
    hot_999: stats999.mainTop.slice(0, 5),
    cold_999: stats999.mainCold.slice(0, 5),
    strong_hot_100: stats100.strongTop,
    strong_cold_100: stats100.strongCold,
    even_odd_100: { evenPct: stats100.evenPct, oddPct: stats100.oddPct },
    even_odd_999: { evenPct: stats999.evenPct, oddPct: stats999.oddPct },
    buckets_100: stats100.buckets,
    buckets_999: stats999.buckets,
    risers: cmp.risers.slice(0, 5).map((x) => ({ num: x.num, deltaPctPoints: (x.delta * 100).toFixed(2) })),
    fallers: cmp.fallers.slice(0, 5).map((x) => ({ num: x.num, deltaPctPoints: (x.delta * 100).toFixed(2) })),
  };

  const prompt = `
אתה אנליסט נתונים בכיר.
קיבלת סיכום סטטיסטי של תוצאות לוטו: חלון 100 הגרלות אחרונות מול חלון 999 אחרונות.
מטרות:
1) להסיק תובנה מקצועית על ההבדלים בין החלונות (שינויים בתדירויות, פיזור עשירונים, זוגי/אי־זוגי).
2) לזהות מה "התחמם" ומה "התקרר" ב-100 האחרונים ביחס לבייסליין של 999.
3) לשמור על ניסוח חד, אליטיסטי, וללא חפירות.
פלט: 3–4 שורות בעברית בלבד, תמציתיות מאוד.
דאטה (JSON):
${JSON.stringify(dataBrief)}
`.trim();

  // Gemini 2.5 Flash
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(
    GEMINI_API_KEY
  )}`;

  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.35,
      maxOutputTokens: 200,
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Gemini error: ${res.status} ${t}`);
  }

  const json = await res.json();
  const text =
    json?.candidates?.[0]?.content?.parts
      ?.map((p) => p.text)
      .filter(Boolean)
      .join("\n") || null;

  return text;
}

// ====== MAIN ======
async function main() {
  console.log("Starting Lotto AI analysis (100 vs 999) ...");

  const csvPath = findCsvPath();
  if (!csvPath) throw new Error("CSV not found. Expected: data/lotto.csv (or lotto.csv).");

  const csvText = fs.readFileSync(csvPath, "utf8");
  const rows = parseCsvRows(csvText);

  if (rows.length < 50) throw new Error(`Not enough rows parsed from CSV. Parsed=${rows.length}`);

  const last999 = rows.slice(-Math.min(WINDOW_LONG, rows.length));
  const last100 = rows.slice(-Math.min(WINDOW_SHORT, rows.length));

  const stats999 = computeStats(last999);
  const stats100 = computeStats(last100);
  const cmp = compareWindows(stats100, stats999);

  // ===== הודעת סטטיסטיקה (ללא שעה וללא הגרלה אחרונה) =====
  const msgStats = [
    `🎯 <b>Lotto Weekly AI</b>`,
    ``,
    `📊 <b>100 אחרונות</b> — חמים: ${formatTopList(stats100.mainTop, 5)} | קרים: ${formatTopList(stats100.mainCold, 5)}`,
    `⭐ <b>חזק (100)</b> — חמים: ${formatTopList(stats100.strongTop, 3)} | קרים: ${formatTopList(stats100.strongCold, 3)}`,
    `⚖️ <b>זוגי/אי־זוגי (100)</b>: ${(stats100.evenPct * 100).toFixed(1)}% / ${(stats100.oddPct * 100).toFixed(1)}%`,
    ``,
    `📈 <b>999 אחרונות</b> — חמים: ${formatTopList(stats999.mainTop, 5)} | קרים: ${formatTopList(stats999.mainCold, 5)}`,
    `⚖️ <b>זוגי/אי־זוגי (999)</b>: ${(stats999.evenPct * 100).toFixed(1)}% / ${(stats999.oddPct * 100).toFixed(1)}%`,
    ``,
    `🚀 <b>מה התחמם ב-100 מול 999</b>: ${cmp.risers.slice(0, 5).map((x) => `${x.num}(+${(x.delta * 100).toFixed(2)}pp)`).join(", ")}`,
    `🧊 <b>מה התקרר ב-100 מול 999</b>: ${cmp.fallers.slice(0, 5).map((x) => `${x.num}(${(x.delta * 100).toFixed(2)}pp)`).join(", ")}`,
  ].join("\n");

  let aiText = null;
  try {
    aiText = await geminiSummary({ stats100, stats999, cmp });
  } catch (e) {
    console.log("Gemini error:", String(e));
  }

  // ===== בלוק AI מסודר ונקי בסוף =====
  const aiBlock = aiText && aiText.trim().length > 0
    ? `\n\n🧠 <b>ניתוח AI (Gemini 2.5 Flash)</b>\n${escapeHtml(aiText.trim())}`
    : `\n\n🧠 <b>ניתוח AI</b>\nלא התקבל פלט מ-Gemini.`;

  const finalMessage = msgStats + aiBlock;

  await sendTelegram(finalMessage);

  console.log("Done. Sent Telegram message.");
}

function escapeHtml(s) {
  // כדי שלא יתפוצץ parse_mode=HTML
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
