// src/job.js
import fs from "fs";
import path from "path";
import fetch from "node-fetch";
import * as cheerio from "cheerio";

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const TELEGRAM_GROUP_ID = process.env.TELEGRAM_GROUP_ID;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const LOTTO_URL = "https://lotto365.co.il/תוצאות-הלוטו/";

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

// ================= FETCH DRAW =================

async function fetchLatestDrawFromSite() {
  const res = await fetch(LOTTO_URL, {
    headers: { "user-agent": "Mozilla/5.0" },
  });

  if (!res.ok) {
    throw new Error("Failed to fetch lotto page");
  }

  const html = await res.text();
  const $ = cheerio.load(html);
  const pageText = $("body").text();

  const drawMatch = pageText.match(/הגרלה\s*מספר\s*(\d+)/);
  if (!drawMatch) throw new Error("Draw number not found");
  const drawNo = Number(drawMatch[1]);

  const dateMatch = pageText.match(/בתאריך\s*([\d\.\/]+)/);
  const dateStr = dateMatch ? dateMatch[1] : "";

  const nums = [];
  $(".lotto-ball, .ball, .number").each((i, el) => {
    const n = Number($(el).text().trim());
    if (n >= MAIN_MIN && n <= MAIN_MAX) nums.push(n);
  });

  if (nums.length < 6) throw new Error("Main numbers not found");

  const mainNums = nums.slice(0, 6);

  let strong = null;
  $(".strong, .lotto-strong").each((i, el) => {
    const n = Number($(el).text().trim());
    if (n >= STRONG_MIN && n <= STRONG_MAX) strong = n;
  });

  if (!strong) throw new Error("Strong number not found");

  let prize1Amount = null;
  let prize1Winners = null;
  let prize2Amount = null;
  let prize2Winners = null;
  let totalPrizes = null;

  $("table tr").each((i, el) => {
    const cols = $(el).find("td");
    if (cols.length < 3) return;

    const rowText = $(el).text();

    if (rowText.includes("פרס ראשון")) {
      prize1Winners = Number($(cols[1]).text().replace(/[^\d]/g, "")) || 0;
      prize1Amount = Number($(cols[2]).text().replace(/[^\d]/g, "")) || 0;
    }

    if (rowText.includes("פרס שני")) {
      prize2Winners = Number($(cols[1]).text().replace(/[^\d]/g, "")) || 0;
      prize2Amount = Number($(cols[2]).text().replace(/[^\d]/g, "")) || 0;
    }

    if (rowText.includes("סך הכל פרסים")) {
      totalPrizes = Number($(cols[1]).text().replace(/[^\d]/g, "")) || 0;
    }
  });

  return {
    drawNo,
    dateStr,
    nums: mainNums,
    strong,
    prize1Amount,
    prize1Winners,
    prize2Amount,
    prize2Winners,
    totalPrizes,
  };
}

// ================= HELPERS =================

function findCsvPath() {
  for (const p of CSV_PATH_CANDIDATES) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function appendDrawToCsv(csvPath, draw) {
  const line =
    [draw.drawNo, draw.dateStr, ...draw.nums, draw.strong].join(",") + "\n";
  fs.appendFileSync(csvPath, line);
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

async function sendTelegram(text) {
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

// ================= MAIN =================

async function main() {
  console.log("Starting Lotto AI...");

  const csvPath = findCsvPath();
  if (!csvPath) throw new Error("CSV not found.");

  let latestFromSite;

  try {
    latestFromSite = await fetchLatestDrawFromSite();
  } catch (e) {
    console.error("Draw fetch failed:", e.message);
    process.exit(1);
  }

  const existingText = fs.readFileSync(csvPath, "utf8");
  const rows = existingText.trim().split("\n");
  const lastLine = rows[rows.length - 1];
  const lastDrawNo = Number(lastLine.split(",")[0]);

  let isNew = false;

  if (latestFromSite.drawNo !== lastDrawNo) {
    appendDrawToCsv(csvPath, latestFromSite);
    isNew = true;
    console.log("New draw appended:", latestFromSite.drawNo);
  }

  const drawBlock =
    (isNew ? "🚨 <b>הגרלה חדשה!</b>\n\n" : "🎰 <b>הגרלה אחרונה</b>\n\n") +
    `מספר הגרלה: <b>${latestFromSite.drawNo}</b>\n` +
    `מספרים: ${latestFromSite.nums.join(", ")}\n` +
    `חזק: ${latestFromSite.strong}\n` +
    `\n🥇 פרס ראשון: ${latestFromSite.prize1Amount || 0} ₪ | זוכים: ${latestFromSite.prize1Winners || 0}` +
    `\n🥈 פרס שני: ${latestFromSite.prize2Amount || 0} ₪ | זוכים: ${latestFromSite.prize2Winners || 0}` +
    (latestFromSite.totalPrizes
      ? `\n💰 סך פרסים שחולקו: ${latestFromSite.totalPrizes} ₪`
      : "");

  await sendTelegram(drawBlock);

  console.log("Done.");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
