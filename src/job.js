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

const FORM_LINES = 8;

// ✅ URL של lotto365
const LOTTO_URL = "https://lotto365.co.il/תוצאות-הלוטו/";

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

// ====== 🔥 FETCH LATEST DRAW FROM lotto365 ======
async function fetchLatestDrawFromSite() {
  const res = await fetch(LOTTO_URL, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "accept-language": "he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7",
    },
  });

  if (!res.ok) {
    throw new Error(`Failed fetching lotto365: HTTP ${res.status}`);
  }

  const html = await res.text();
  const $ = cheerio.load(html);
  const pageText = $.text().replace(/\s+/g, " ").trim();

  // מספר הגרלה
  const drawNoMatch = pageText.match(/תוצאות\s+הגרלת\s+לוטו\s+מס[׳']?\s*(\d+)/);
  const drawNo = drawNoMatch ? Number(drawNoMatch[1]) : null;

  // ====== 🎯 מציאת data-id לפי צבע מתוך <style> ======
  // מחפשים ב-CSS את ה-elementor-element-XXXXXXX שיש לו background כחול (#33B5F7)
  const styleText = $("style").text();

  const strongIdFromCss =
    styleText.match(/elementor-element-([a-f0-9]{5,10})[\s\S]{0,120}?jet-listing-dynamic-field__content[\s\S]{0,200}?background:\s*#33b5f7/i)?.[1] ||
    null;

  const mainIdFromCss =
    styleText.match(/elementor-element-([a-f0-9]{5,10})[\s\S]{0,120}?jet-listing-dynamic-field__content[\s\S]{0,200}?background:\s*#ff5733/i)?.[1] ||
    null;

  // Fallbackים לפי מה שראית בדפדפן (אם ה-CSS לא נתפס)
  const STRONG_FALLBACK_ID = "281599c";
  const MAIN_FALLBACK_ID = "562e6d3";

  const strongDataId = strongIdFromCss || STRONG_FALLBACK_ID;
  const mainDataId = mainIdFromCss || MAIN_FALLBACK_ID;

  // ====== ✅ חילוץ 6 המספרים הכתומים (רגילים) ======
 // ---- Collect all <style> text ----
const styleTextAll = $("style")
  .map((_, el) => $(el).text())
  .get()
  .join("\n");

function extractIdsByBg(hex) {
  const ids = new Set();
  const re = new RegExp(
    `elementor-element-([a-f0-9]{5,10})[\\s\\S]{0,400}?jet-listing-dynamic-field__content[\\s\\S]{0,400}?background:\\s*${hex}`,
    "ig"
  );
  let m;
  while ((m = re.exec(styleTextAll))) ids.add(m[1]);
  return [...ids];
}

const STRONG_BG = "#33B5F7"; // כחול
const MAIN_BG = "#ff5733";   // כתום

const strongIds = extractIdsByBg(STRONG_BG);
const mainIds = extractIdsByBg(MAIN_BG);

const STRONG_FALLBACK_ID = "281599c";
const MAIN_FALLBACK_ID = "562e6d3";

const strongDataId = strongIds[0] || STRONG_FALLBACK_ID;
const mainDataIds = mainIds.length ? mainIds : [MAIN_FALLBACK_ID];

// ---- Strong number ----
const strongText = $(`[data-id="${strongDataId}"] .jet-listing-dynamic-field__content`)
  .first()
  .text()
  .trim();

const strong = /^\d{1,2}$/.test(strongText) ? Number(strongText) : null;

// ---- Main numbers ----
const mainNumsRaw = [];

for (const id of mainDataIds) {
  $(`[data-id="${id}"] .jet-listing-dynamic-field__content`).each((_, el) => {
    const t = $(el).text().trim();
    if (/^\d{1,2}$/.test(t)) {
      const n = Number(t);
      if (n >= MAIN_MIN && n <= MAIN_MAX) mainNumsRaw.push(n);
    }
  });
}

// remove duplicates
const seen = new Set();
let mainNums = mainNumsRaw.filter((n) => (seen.has(n) ? false : (seen.add(n), true)));

if (strong != null) {
  const idx = mainNums.indexOf(strong);
  if (idx !== -1) mainNums.splice(idx, 1);
}

mainNums = mainNums.slice(0, 6);

  // ====== פרסים (כמו שהיה אצלך) ======
  const prize1Match = pageText.match(/פרס ראשון.*?([\d,]+)\s*₪.*?(\d+|לא\s*חולק)\s*זוכ/);
  const prize2Match = pageText.match(/פרס שני.*?([\d,]+)\s*₪.*?(\d+|לא\s*חולק)\s*זוכ/);
  const totalPrizesMatch = pageText.match(/ס[הך]"?כ.*?([\d,]+)\s*₪/);

  const prize1Amount = prize1Match ? prize1Match[1] : null;
  const prize1Winners = prize1Match ? prize1Match[2] : null;

  const prize2Amount = prize2Match ? prize2Match[1] : null;
  const prize2Winners = prize2Match ? prize2Match[2] : null;

  const totalPrizes = totalPrizesMatch ? totalPrizesMatch[1] : null;

  // בדיקות תקינות
  const unique6 = new Set(mainNums).size === 6;
  const okStrong = strong != null && strong >= STRONG_MIN && strong <= STRONG_MAX;

  if (!drawNo || mainNums.length !== 6 || !unique6 || !okStrong) {
    throw new Error(
      `Failed extracting lotto results from lotto365 (drawNo=${drawNo}, main=${mainNums.join(
        ","
      )}, strong=${strong}, mainDataId=${mainDataId}, strongDataId=${strongDataId})`
    );
  }

  return {
    drawNo,
    dateStr: new Date().toISOString().slice(0, 10),
    nums: mainNums,
    strong,
    prize1Amount,
    prize1Winners,
    prize2Amount,
    prize2Winners,
    totalPrizes,
  };
}
function appendDrawToCsv(csvPath, draw) {
  const line =
    [draw.drawNo, draw.dateStr, ...draw.nums, draw.strong].join(",") + "\n";
  fs.appendFileSync(csvPath, line);
}

function escapeHtml(s) {
  return String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

async function sendTelegram(text) {
  if (!TELEGRAM_BOT_TOKEN) {
    console.log("Missing TELEGRAM_BOT_TOKEN");
    return;
  }

  const targets = [TELEGRAM_CHAT_ID, TELEGRAM_GROUP_ID].filter(Boolean);
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

  for (const chat_id of targets) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });

    const data = await res.json().catch(() => ({}));
    if (!data?.ok) {
      console.error("Telegram send failed:", chat_id, data);
    } else {
      console.log("Sent to:", chat_id);
    }
  }
}

// ====== STATS ======
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

function compareWindows(stats100, stats999) {
  const deltas = [];
  for (let i = MAIN_MIN; i <= MAIN_MAX; i++) {
    const r100 = stats100.totalMainPicks ? stats100.mainFreq[i] / stats100.totalMainPicks : 0;
    const r999 = stats999.totalMainPicks ? stats999.mainFreq[i] / stats999.totalMainPicks : 0;
    deltas.push({ num: i, delta: r100 - r999 });
  }

  deltas.sort((a, b) => b.delta - a.delta);
  const risers = deltas.slice(0, 7);
  const fallers = [...deltas].reverse().slice(0, 7);

  return { risers, fallers };
}

function formatTopList(list, maxItems = 5) {
  return list
    .slice(0, maxItems)
    .map((x) => `${x.num}(${x.c})`)
    .join(", ");
}

function formatBuckets(buckets) {
  return buckets.map((b) => `${b.name}: ${(b.pct * 100).toFixed(1)}%`).join(" | ");
}

// ====== RECOMMENDATIONS (8 lines) ======
function weightedPick(items) {
  const total = items.reduce((s, x) => s + x.weight, 0);
  let r = Math.random() * total;
  for (const it of items) {
    r -= it.weight;
    if (r <= 0) return it.value;
  }
  return items[items.length - 1].value;
}

function makeUniquePick(pool, pickedSet, maxTries = 50) {
  for (let i = 0; i < maxTries; i++) {
    const v = weightedPick(pool);
    if (!pickedSet.has(v)) return v;
  }
  for (const it of pool) {
    if (!pickedSet.has(it.value)) return it.value;
  }
  return pool[0].value;
}

function buildWeightedMainPool(stats999, hotNums, riserNums) {
  const pool = [];
  for (let n = MAIN_MIN; n <= MAIN_MAX; n++) {
    const freq = stats999.mainFreq[n] || 0;

    let w = 1.0;
    if (hotNums.has(n)) w += 2.0;
    if (riserNums.has(n)) w += 2.2;
    w += Math.min(1.2, freq / 150);

    pool.push({ value: n, weight: w });
  }
  return pool;
}

function buildWeightedStrongPool(stats100) {
  const pool = [];
  for (let s = STRONG_MIN; s <= STRONG_MAX; s++) {
    const f = stats100.strongFreq[s] || 0;
    const w = 1.0 + Math.min(2.0, f / 20);
    pool.push({ value: s, weight: w });
  }
  return pool;
}

function bucketIndex(n) {
  if (n <= 10) return 0;
  if (n <= 20) return 1;
  if (n <= 30) return 2;
  return 3;
}

function generateFormLines(stats100, stats999, cmp) {
  const hotNums = new Set(stats999.mainTop.map((x) => x.num));
  const riserNums = new Set(cmp.risers.slice(0, 7).map((x) => x.num));

  const mainPool = buildWeightedMainPool(stats999, hotNums, riserNums);
  const strongPool = buildWeightedStrongPool(stats100);

  const lines = [];

  for (let i = 0; i < FORM_LINES; i++) {
    const picked = new Set();
    const bucketsUsed = [0, 0, 0, 0];

    while (picked.size < 6) {
      const n = makeUniquePick(mainPool, picked);
      const bi = bucketIndex(n);
      if (bucketsUsed[bi] >= 2) continue;

      picked.add(n);
      bucketsUsed[bi] += 1;
    }

    const mainNums = [...picked].sort((a, b) => a - b);
    const strong = weightedPick(strongPool);

    lines.push({ mainNums, strong });
  }

  return lines;
}

function formatFormLines(lines) {
  return lines
    .map((l, idx) => {
      const nums = l.mainNums.map((n) => String(n).padStart(2, "0")).join(" ");
      return `${idx + 1}) ${nums} | חזק: ${l.strong}`;
    })
    .join("\n");
}

// ====== GEMINI SUMMARY ======
async function geminiSummary({ stats100, stats999, cmp }) {
  if (!GEMINI_API_KEY) return null;

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
    risers: cmp.risers.slice(0, 5).map((x) => ({ num: x.num, deltaPP: Number((x.delta * 100).toFixed(2)) })),
    fallers: cmp.fallers.slice(0, 5).map((x) => ({ num: x.num, deltaPP: Number((x.delta * 100).toFixed(2)) })),
  };

  const prompt = `
אתה אנליסט נתונים בכיר.
השווה בין 100 ההגרלות האחרונות לבין 999 האחרונות.
מטרות: לזהות מגמה, התחממות/התקררות, פיזור טווחים וזוגי/אי-זוגי.
פלט: 3–4 שורות בעברית בלבד, חדות ותמציתיות (בלי חפירות).

דאטה (JSON):
${JSON.stringify(dataBrief)}
`.trim();

  const model = "gemini-2.5-flash-lite";
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent` +
    `?key=${encodeURIComponent(GEMINI_API_KEY)}`;

  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.35, maxOutputTokens: 220 },
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

  let latestFromSite = null;
  let isNewDraw = false;

  // ✅ תמיד מושכים את ההגרלה האחרונה + מזהים אם חדשה
  try {
    latestFromSite = await fetchLatestDrawFromSite();

    const existingText = fs.readFileSync(csvPath, "utf8");
    const rowsExisting = parseCsvRows(existingText);
    const lastDraw = rowsExisting.length ? rowsExisting[rowsExisting.length - 1].drawNo : null;

    if (latestFromSite.drawNo !== lastDraw) {
      appendDrawToCsv(csvPath, latestFromSite);
      isNewDraw = true;
      console.log("New draw added:", latestFromSite.drawNo);
    } else {
      console.log("No new draw detected.");
    }
  } catch (e) {
    console.log("Draw fetch error:", e.message);
  }

  // טוענים מחדש אחרי שאולי נוספה שורה
  const csvText = fs.readFileSync(csvPath, "utf8");
  const rows = parseCsvRows(csvText);
  if (rows.length < 50) throw new Error(`Not enough rows parsed from CSV. Parsed=${rows.length}`);

  const lastDrawRow = rows[rows.length - 1];

  // ✅ בלוק ההגרלה האחרונה + פרסים (אם קיימים)
  const drawBlock =
    (isNewDraw ? `🚨 <b>הגרלה חדשה!</b>\n\n` : `🎰 <b>הגרלה אחרונה</b>\n\n`) +
    `מספר הגרלה: <b>${lastDrawRow.drawNo}</b>\n` +
    `מספרים: ${lastDrawRow.nums.join(", ")}\n` +
    `חזק: ${lastDrawRow.strong}\n` +
    (latestFromSite?.prize1Amount
      ? `\n🥇 פרס ראשון: ${latestFromSite.prize1Amount} ₪ | זוכים: ${latestFromSite.prize1Winners || "0"}`
      : "") +
    (latestFromSite?.prize2Amount
      ? `\n🥈 פרס שני: ${latestFromSite.prize2Amount} ₪ | זוכים: ${latestFromSite.prize2Winners || "0"}`
      : "") +
    (latestFromSite?.totalPrizes
      ? `\n💰 סך פרסים שחולקו: ${latestFromSite.totalPrizes} ₪`
      : "");

  const last999 = rows.slice(-Math.min(WINDOW_LONG, rows.length));
  const last100 = rows.slice(-Math.min(WINDOW_SHORT, rows.length));

  const stats999 = computeStats(last999);
  const stats100 = computeStats(last100);
  const cmp = compareWindows(stats100, stats999);

  const msgStats = [
    `🎯 <b>Lotto Weekly AI</b>`,
    ``,
    `📊 <b>100 אחרונות</b> — חמים: ${formatTopList(stats100.mainTop, 5)} | קרים: ${formatTopList(stats100.mainCold, 5)}`,
    `⭐ <b>חזק (100)</b> — חמים: ${formatTopList(stats100.strongTop, 3)} | קרים: ${formatTopList(stats100.strongCold, 3)}`,
    `⚖️ <b>זוגי/אי־זוגי (100)</b>: ${(stats100.evenPct * 100).toFixed(1)}% / ${(stats100.oddPct * 100).toFixed(1)}%`,
    `🧩 <b>פיזור טווחים (100)</b>: ${formatBuckets(stats100.buckets)}`,
    ``,
    `📈 <b>999 אחרונות</b> — חמים: ${formatTopList(stats999.mainTop, 5)} | קרים: ${formatTopList(stats999.mainCold, 5)}`,
    `⚖️ <b>זוגי/אי־זוגי (999)</b>: ${(stats999.evenPct * 100).toFixed(1)}% / ${(stats999.oddPct * 100).toFixed(1)}%`,
    `🧩 <b>פיזור טווחים (999)</b>: ${formatBuckets(stats999.buckets)}`,
    ``,
    `🚀 <b>התחממו (100 מול 999)</b>: ${cmp.risers
      .slice(0, 5)
      .map((x) => `${x.num}(+${(x.delta * 100).toFixed(2)}pp)`)
      .join(", ")}`,
    `🧊 <b>התקררו (100 מול 999)</b>: ${cmp.fallers
      .slice(0, 5)
      .map((x) => `${x.num}(${(x.delta * 100).toFixed(2)}pp)`)
      .join(", ")}`,
  ].join("\n");

  const formLines = generateFormLines(stats100, stats999, cmp);
  const formBlock =
    `\n\n🎟 <b>טופס מומלץ (${FORM_LINES} שורות)</b>\n` +
    escapeHtml(formatFormLines(formLines));

  let aiText = null;
  try {
    aiText = await geminiSummary({ stats100, stats999, cmp });
  } catch (e) {
    console.log("Gemini error:", String(e));
  }

  const aiBlock =
    aiText && aiText.trim().length > 0
      ? `\n\n🧠 <b>סיכום AI</b>\n${escapeHtml(aiText.trim())}`
      : `\n\n🧠 <b>סיכום AI</b>\nלא התקבל פלט מ-Gemini (בדוק GEMINI_API_KEY / הרשאות).`;

  await sendTelegram(drawBlock + "\n\n" + msgStats + formBlock + aiBlock);

  console.log("Done. Sent Telegram message.");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
