// src/job.js
import fs from "fs";
import path from "path";
import fetch from "node-fetch";
import cheerio from "cheerio";

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const TELEGRAM_GROUP_ID = process.env.TELEGRAM_GROUP_ID;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// ====== CONFIG ======
const CSV_PATH_CANDIDATES = [
  path.join("data", "lotto.csv"),
  "lotto.csv",
  path.join("data", "Lotto.csv"),
  "Lotto.csv",
];

const MAIN_MIN = 1;
const MAIN_MAX = 37;
const STRONG_MIN = 1;
const STRONG_MAX = 7;

const WINDOW_LONG = 999;
const WINDOW_SHORT = 100;

const FORM_LINES = 8;

const LOTTO_URL = "https://www.pais.co.il/lotto/";

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
 * פורמט צפוי:
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

    const inMainRange = nums.every((n) => n >= MAIN_MIN && n <= MAIN_MAX);
    const inStrongRange = strong >= STRONG_MIN && strong <= STRONG_MAX;
    if (!inMainRange || !inStrongRange) continue;

    rows.push({ drawNo, dateStr, nums, strong });
  }

  rows.sort((a, b) => a.drawNo - b.drawNo);
  return rows;
}

// ====== 🔥 FETCH LATEST DRAW FROM SITE ======
async function fetchLatestDrawFromSite() {
  const res = await fetch(LOTTO_URL);
  const html = await res.text();
  const $ = cheerio.load(html);

  const headerText = $("h3").first().text();
  const drawMatch = headerText.match(/\d+/);
  const drawNo = drawMatch ? Number(drawMatch[0]) : null;

  const balls = [];
  $(".loto_info_num").each((i, el) => {
    balls.push(Number($(el).text().trim()));
  });

  if (!drawNo || balls.length < 7) {
    throw new Error("Failed extracting lotto results");
  }

  return {
    drawNo,
    dateStr: new Date().toISOString().slice(0, 10),
    nums: balls.slice(0, 6),
    strong: balls[6],
  };
}

function appendDrawToCsv(csvPath, draw) {
  const line = [
    draw.drawNo,
    draw.dateStr,
    ...draw.nums,
    draw.strong,
  ].join(",") + "\n";

  fs.appendFileSync(csvPath, line);
}

async function sendTelegram(text) {
  if (!TELEGRAM_BOT_TOKEN) return;

  const targets = [TELEGRAM_CHAT_ID, TELEGRAM_GROUP_ID].filter(Boolean);
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

  for (const chat_id of targets) {
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
  }
}

// ====== כל הקוד הקיים שלך נשאר אותו דבר מכאן ↓↓↓ ======

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
    pct: totalMainPicks ? b.count / totalMainPicks : 0,
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
    evenPct: totalMainPicks ? even / totalMainPicks : 0,
    oddPct: totalMainPicks ? odd / totalMainPicks : 0,
    buckets: bucketSummary,
  };
}

// ====== MAIN ======
async function main() {
  console.log("Starting Lotto AI analysis (100 vs 999) ...");

  const csvPath = findCsvPath();
  if (!csvPath) throw new Error("CSV not found.");

  // 🔥 בדיקת הגרלה חדשה לפני אנליזה
  try {
    const latest = await fetchLatestDrawFromSite();
    const existingText = fs.readFileSync(csvPath, "utf8");
    const rowsExisting = parseCsvRows(existingText);
    const lastDraw = rowsExisting.length ? rowsExisting[rowsExisting.length - 1].drawNo : null;

    if (latest.drawNo !== lastDraw) {
      appendDrawToCsv(csvPath, latest);

      await sendTelegram(
        `🎰 <b>הגרלה חדשה!</b>\n\n` +
        `מספר: ${latest.drawNo}\n` +
        `מספרים: ${latest.nums.join(", ")}\n` +
        `חזק: ${latest.strong}`
      );

      console.log("New draw added:", latest.drawNo);
    } else {
      console.log("No new draw detected.");
    }
  } catch (e) {
    console.log("Draw fetch error:", e.message);
  }

  // ממשיך לאנליזה הקיימת שלך בדיוק כמו קודם
  const csvText = fs.readFileSync(csvPath, "utf8");
  const rows = parseCsvRows(csvText);

  if (rows.length < 50) throw new Error(`Not enough rows parsed from CSV. Parsed=${rows.length}`);

  const last999 = rows.slice(-Math.min(WINDOW_LONG, rows.length));
  const last100 = rows.slice(-Math.min(WINDOW_SHORT, rows.length));

  const stats999 = computeStats(last999);
  const stats100 = computeStats(last100);

  await sendTelegram("🤖 Lotto AI system active and updated.");

  console.log("Done.");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
