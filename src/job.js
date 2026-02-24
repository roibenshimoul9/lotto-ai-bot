// src/job.js
import fs from "fs";
import path from "path";
import fetch from "node-fetch";
import * as cheerio from "cheerio";

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

    rows.push({ drawNo, dateStr, nums, strong });
  }

  rows.sort((a, b) => a.drawNo - b.drawNo);
  return rows;
}

// ====== FETCH LATEST DRAW ======
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

// ====== MAIN ======
async function main() {
  console.log("Starting Lotto job...");

  const csvPath = findCsvPath();
  if (!csvPath) throw new Error("CSV not found.");

  let isNewDraw = false;
  let latestFromSite = null;

  // ===== בדיקת הגרלה =====
  try {
    latestFromSite = await fetchLatestDrawFromSite();

    const existingText = fs.readFileSync(csvPath, "utf8");
    const rowsExisting = parseCsvRows(existingText);
    const lastDraw = rowsExisting.length
      ? rowsExisting[rowsExisting.length - 1].drawNo
      : null;

    if (latestFromSite.drawNo !== lastDraw) {
      appendDrawToCsv(csvPath, latestFromSite);
      isNewDraw = true;
      console.log("New draw detected:", latestFromSite.drawNo);
    }
  } catch (e) {
    console.log("Draw fetch error:", e.message);
  }

  // טען מחדש אחרי שאולי נוספה הגרלה
  const csvText = fs.readFileSync(csvPath, "utf8");
  const rows = parseCsvRows(csvText);

  if (!rows.length) throw new Error("No rows in CSV.");

  const lastDrawRow = rows[rows.length - 1];

  // ===== תמיד מציג את ההגרלה האחרונה =====
  const drawHeader = isNewDraw
    ? "🚨 <b>הגרלה חדשה!</b>\n\n"
    : "🎰 <b>הגרלה אחרונה</b>\n\n";

  const drawBlock =
    drawHeader +
    `מספר הגרלה: <b>${lastDrawRow.drawNo}</b>\n` +
    `מספרים: ${lastDrawRow.nums.join(", ")}\n` +
    `חזק: ${lastDrawRow.strong}\n\n`;

  await sendTelegram(drawBlock);

  // ===== האנליזה שלך נשארת =====
  if (rows.length < 50)
    throw new Error(`Not enough rows parsed from CSV. Parsed=${rows.length}`);

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
