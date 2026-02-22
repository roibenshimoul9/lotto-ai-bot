// src/job.js
// ESM module (works with "type": "module" in package.json)

import fs from "node:fs";
import path from "node:path";

const CSV_PATH = path.join("data", "lotto.csv");

// Israel Lotto assumptions:
// - Main numbers: 6 numbers from 1..37
// - Strong number: 1 number from 1..7
const MAIN_MIN = 1;
const MAIN_MAX = 37;
const STRONG_MIN = 1;
const STRONG_MAX = 7;

const LAST_N_DRAWS = 1000;
const RECOMMENDATION_LINES = 8;

function toJerusalemDate() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Jerusalem" }));
}

function isMonFriMorningIL(nowIL) {
  const day = nowIL.getDay(); // 0 Sun .. 6 Sat
  const hour = nowIL.getHours();
  // "בבוקר" — בחרתי 07:00-11:59 (אפשר לשנות)
  return (day === 1 || day === 5) && hour >= 7 && hour <= 11;
}

function parseCsvLines(raw) {
  // Accepts CSV without header OR with header.
  // Expected per line (example): drawId,date,n1,n2,n3,n4,n5,n6,strong
  // Some files may include extra columns at end -> we ignore extras.
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  // If header exists, skip it when first cell isn't numeric
  const first = lines[0]?.split(",")[0]?.trim();
  const startIndex = first && /^\d+$/.test(first) ? 0 : 1;

  const rows = [];
  for (let i = startIndex; i < lines.length; i++) {
    const parts = lines[i].split(",").map((p) => p.trim());
    if (parts.length < 9) continue;

    const drawId = Number(parts[0]);
    const date = parts[1];

    const main = parts.slice(2, 8).map(Number);
    const strong = Number(parts[8]);

    if (!Number.isFinite(drawId)) continue;
    if (main.some((x) => !Number.isFinite(x))) continue;
    if (!Number.isFinite(strong)) continue;

    rows.push({ drawId, date, main, strong });
  }

  // Sort by drawId ascending (safe)
  rows.sort((a, b) => a.drawId - b.drawId);

  return rows;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function makeFreqMap(min, max) {
  const m = new Map();
  for (let i = min; i <= max; i++) m.set(i, 0);
  return m;
}

function updateFreq(freqMap, nums) {
  for (const n of nums) {
    if (freqMap.has(n)) freqMap.set(n, freqMap.get(n) + 1);
  }
}

function topK(freqMap, k, desc = true) {
  const arr = [...freqMap.entries()].map(([num, count]) => ({ num, count }));
  arr.sort((a, b) => (desc ? b.count - a.count : a.count - b.count) || (a.num - b.num));
  return arr.slice(0, k);
}

function computeRecency(rows) {
  // Returns maps: lastSeenMain, lastSeenStrong (distance in draws from newest)
  const lastSeenMain = new Map();
  const lastSeenStrong = new Map();

  const newestIndex = rows.length - 1;

  for (let idx = newestIndex; idx >= 0; idx--) {
    const dist = newestIndex - idx; // 0 = appeared in latest draw
    const { main, strong } = rows[idx];

    for (const n of main) {
      if (!lastSeenMain.has(n)) lastSeenMain.set(n, dist);
    }
    if (!lastSeenStrong.has(strong)) lastSeenStrong.set(strong, dist);
  }

  // If never seen in range, set to Infinity
  for (let i = MAIN_MIN; i <= MAIN_MAX; i++) {
    if (!lastSeenMain.has(i)) lastSeenMain.set(i, Infinity);
  }
  for (let i = STRONG_MIN; i <= STRONG_MAX; i++) {
    if (!lastSeenStrong.has(i)) lastSeenStrong.set(i, Infinity);
  }

  return { lastSeenMain, lastSeenStrong };
}

function expectedCountMain(nDraws) {
  // In each draw, 6 main numbers out of 37
  return nDraws * (6 / (MAIN_MAX - MAIN_MIN + 1));
}

function expectedCountStrong(nDraws) {
  // 1 strong number out of 7
  return nDraws * (1 / (STRONG_MAX - STRONG_MIN + 1));
}

function chiSquare(freqMap, expected) {
  // basic chi-square goodness-of-fit (not a p-value, just score)
  let score = 0;
  for (const [, count] of freqMap.entries()) {
    const diff = count - expected;
    score += (diff * diff) / (expected || 1);
  }
  return score;
}

function weightedPick(items) {
  // items: [{num, weight}]
  const total = items.reduce((s, x) => s + x.weight, 0);
  let r = Math.random() * total;
  for (const it of items) {
    r -= it.weight;
    if (r <= 0) return it.num;
  }
  return items[items.length - 1].num;
}

function buildRecommendationLines(mainFreq, strongFreq, lastSeenMain, lastSeenStrong) {
  // Strategy:
  // - Use a mix of hot (high freq), cold (low freq), and "due" (not seen recently)
  // - Keep numbers spread (avoid too many from same decade)
  // - For strong: mix hot/cold and due

  const mainArr = [...mainFreq.entries()].map(([num, count]) => ({ num, count }));
  mainArr.sort((a, b) => b.count - a.count || a.num - b.num);

  const strongArr = [...strongFreq.entries()].map(([num, count]) => ({ num, count }));
  strongArr.sort((a, b) => b.count - a.count || a.num - b.num);

  // Buckets
  const hotMain = mainArr.slice(0, 12);
  const coldMain = mainArr.slice(-12);
  const midMain = mainArr.slice(12, -12);

  const hotStrong = strongArr.slice(0, 3);
  const coldStrong = strongArr.slice(-3);
  const midStrong = strongArr.slice(3, -3);

  function scoreDueMain(num) {
    const d = lastSeenMain.get(num);
    // More weight if not seen recently
    if (d === Infinity) return 3;
    if (d >= 200) return 2.5;
    if (d >= 100) return 2.0;
    if (d >= 50) return 1.5;
    return 1.0;
  }

  function scoreDueStrong(num) {
    const d = lastSeenStrong.get(num);
    if (d === Infinity) return 3;
    if (d >= 120) return 2.0;
    if (d >= 60) return 1.5;
    return 1.0;
  }

  function pick6() {
    const chosen = new Set();

    // Plan: 2 hot + 2 mid + 2 cold/due
    const plan = ["hot", "hot", "mid", "mid", "cold", "due"];

    for (const slot of plan) {
      let pool;
      if (slot === "hot") pool = hotMain;
      else if (slot === "mid") pool = midMain;
      else if (slot === "cold") pool = coldMain;
      else pool = mainArr; // due from all

      // Weighted by due score + slight preference for frequency in hot/mid
      const weighted = pool.map(({ num, count }) => {
        const base =
          slot === "hot" ? 1.6 :
          slot === "mid" ? 1.2 :
          slot === "cold" ? 1.0 : 1.0;

        const freqBoost =
          slot === "hot" ? (1 + count / 50) :
          slot === "mid" ? (1 + count / 80) :
          1.0;

        const due = scoreDueMain(num);
        return { num, weight: base * freqBoost * due };
      });

      // Pick unique with retries
      let picked = null;
      for (let tries = 0; tries < 30; tries++) {
        const candidate = weightedPick(weighted);
        if (!chosen.has(candidate)) {
          picked = candidate;
          break;
        }
      }
      if (picked == null) {
        // fallback: first unused
        const firstUnused = weighted.find((w) => !chosen.has(w.num))?.num ?? weighted[0].num;
        picked = firstUnused;
      }
      chosen.add(picked);
    }

    // Spread heuristic: if too clustered, lightly adjust by swapping one number
    let nums = [...chosen].sort((a, b) => a - b);

    const decades = nums.map((n) => Math.floor((n - 1) / 10));
    const maxSameDecade = Math.max(...decades.map((d) => decades.filter((x) => x === d).length));
    if (maxSameDecade >= 4) {
      // swap the middle number with a mid-range unused
      const candidatePool = midMain
        .map((x) => x.num)
        .filter((n) => !chosen.has(n));
      if (candidatePool.length) {
        const replaceIndex = 2;
        chosen.delete(nums[replaceIndex]);
        const replacement = candidatePool[Math.floor(Math.random() * candidatePool.length)];
        chosen.add(replacement);
        nums = [...chosen].sort((a, b) => a - b);
      }
    }

    return nums;
  }

  function pickStrong() {
    const roll = Math.random();
    let pool;
    if (roll < 0.4) pool = hotStrong;
    else if (roll < 0.7) pool = midStrong;
    else pool = coldStrong;

    const weighted = pool.map(({ num, count }) => ({
      num,
      weight: (1 + count / 200) * scoreDueStrong(num),
    }));

    return weightedPick(weighted);
  }

  const lines = [];
  for (let i = 0; i < RECOMMENDATION_LINES; i++) {
    const main = pick6();
    const strong = pickStrong();
    lines.push({ main, strong });
  }
  return lines;
}

function fmtNums(nums) {
  return nums.map((n) => String(n).padStart(2, "0")).join(" ");
}

function fmtLine(i, main, strong) {
  return `${i + 1}) ${fmtNums(main)} | חזק: ${strong}`;
}

async function sendTelegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.log("Telegram not configured (missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID).");
    return;
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Telegram send failed: ${res.status} ${body}`);
  }
}

async function geminiAnalyze({ model, apiKey, payloadText }) {
  // Google Generative Language API (Gemini via API key)
  // Endpoint:
  // https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key=API_KEY
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const body = {
    contents: [
      {
        role: "user",
        parts: [{ text: payloadText }],
      },
    ],
    generationConfig: {
      temperature: 0.35,
      topP: 0.9,
      maxOutputTokens: 450,
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const json = await res.json().catch(() => null);

  if (!res.ok) {
    const msg = json?.error?.message || `HTTP ${res.status}`;
    const code = json?.error?.code || res.status;
    const status = json?.error?.status || "ERROR";
    throw new Error(`Gemini error (${code} ${status}): ${msg}`);
  }

  const text =
    json?.candidates?.[0]?.content?.parts?.map((p) => p.text).filter(Boolean).join("\n") ||
    "";

  return text.trim();
}

function buildGeminiPrompt({
  nDraws,
  latestDraw,
  hotMain,
  coldMain,
  hotStrong,
  coldStrong,
  chiMain,
  chiStrong,
  lines,
}) {
  // תמציתי, “אליטי”, בעברית
  // לא להבטיח זכייה, לא להציג כוודאי
  return `
אתה אנליסט נתונים. תן סיכום תמציתי מאוד בעברית על סטטיסטיקת לוטו (אקראי, אין הבטחת זכייה).
הנתונים הם ${nDraws} ההגרלות האחרונות.

ההגרלה האחרונה (#${latestDraw.drawId}, ${latestDraw.date}):
מספרים: ${latestDraw.main.join(", ")} | חזק: ${latestDraw.strong}

"חמים" (תדירות גבוהה) מספרים ראשיים: ${hotMain.map((x) => `${x.num}(${x.count})`).join(", ")}
"קרים" (תדירות נמוכה) מספרים ראשיים: ${coldMain.map((x) => `${x.num}(${x.count})`).join(", ")}

"חמים" חזק: ${hotStrong.map((x) => `${x.num}(${x.count})`).join(", ")}
"קרים" חזק: ${coldStrong.map((x) => `${x.num}(${x.count})`).join(", ")}

מדד סטייה (Chi-Square) ראשיים: ${chiMain.toFixed(1)} | חזק: ${chiStrong.toFixed(1)}

בנוסף יש 8 שורות המלצה שכבר נבנו סטטיסטית (ערבוב חמים/קרים/ביניים):
${lines.map((l, i) => fmtLine(i, l.main, l.strong)).join("\n")}

דרישות לתשובה:
1) כותרת אחת קצרה.
2) 3 נקודות בולטים על סטטיסטיקה (חמים/קרים + מה זה אומר בפועל).
3) אזהרת שורה אחת: "לוטו אקראי".
4) בסוף: להציג את 8 השורות בדיוק כמו שהן (ללא שינוי מספרים), תחת כותרת "טופס מומלץ (8 שורות)".
5) להיות קצר, חד, "אנליטי". בלי חפירות.
`.trim();
}

function safeHtml(text) {
  // very basic HTML escape for Telegram (avoid breaking)
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function buildFinalMessage({ nowIL, nDraws, latestDraw, hotMain, coldMain, hotStrong, coldStrong, lines, geminiText }) {
  const header = `🎯 <b>Lotto Weekly AI</b>\n🕒 ${nowIL.toLocaleString("he-IL")}\n`;
  const stats =
    `\n<b>סיכום סטטיסטי (${nDraws} הגרלות אחרונות)</b>\n` +
    `• חמים (ראשיים): ${hotMain.map((x) => x.num).join(", ")}\n` +
    `• קרים (ראשיים): ${coldMain.map((x) => x.num).join(", ")}\n` +
    `• חזק חם: ${hotStrong.map((x) => x.num).join(", ")} | חזק קר: ${coldStrong.map((x) => x.num).join(", ")}\n` +
    `• אחרונה (#${latestDraw.drawId}): ${latestDraw.main.join(", ")} | חזק: ${latestDraw.strong}\n`;

  const form =
    `\n<b>טופס מומלץ (8 שורות)</b>\n` +
    lines.map((l, i) => safeHtml(fmtLine(i, l.main, l.strong))).join("\n");

  const aiBlock = geminiText
    ? `\n\n<b>ניתוח AI (Gemini)</b>\n${safeHtml(geminiText)}`
    : `\n\n<b>ניתוח AI (Gemini)</b>\nלא זמין כרגע.`;

  const disclaimer = `\n\n<i>הערה: לוטו הוא אקראי — זה ניתוח סטטיסטי/בידורי בלבד.</i>`;

  return header + stats + aiBlock + "\n" + form + disclaimer;
}

async function main() {
  const nowIL = toJerusalemDate();

  const isManualRun = process.env.GITHUB_EVENT_NAME === "workflow_dispatch";
  const isScheduledWindow = isMonFriMorningIL(nowIL);

  if (!isManualRun && !isScheduledWindow) {
    console.log("Not scheduled time.");
    return;
  }

  // Read CSV
  if (!fs.existsSync(CSV_PATH)) {
    throw new Error(`Missing CSV file: ${CSV_PATH}. Make sure data/lotto.csv exists in the repo.`);
  }

  const raw = fs.readFileSync(CSV_PATH, "utf8");
  const allRows = parseCsvLines(raw);

  if (allRows.length < 10) {
    throw new Error(`CSV parsed but has too few rows (${allRows.length}). Check file format.`);
  }

  // take last N
  const rows = allRows.slice(-LAST_N_DRAWS);
  const nDraws = rows.length;

  console.log(`Starting Lotto AI analysis...`);
  console.log(`Total draws in CSV: ${allRows.length}`);
  console.log(`Using last draws: ${nDraws}`);

  const latestDraw = rows[rows.length - 1];

  // Frequencies
  const mainFreq = makeFreqMap(MAIN_MIN, MAIN_MAX);
  const strongFreq = makeFreqMap(STRONG_MIN, STRONG_MAX);

  for (const r of rows) {
    updateFreq(mainFreq, r.main);
    updateFreq(strongFreq, [r.strong]);
  }

  // Hot/Cold (top/bottom)
  const hotMain = topK(mainFreq, 10, true);
  const coldMain = topK(mainFreq, 10, false);
  const hotStrong = topK(strongFreq, 3, true);
  const coldStrong = topK(strongFreq, 3, false);

  // Recency
  const { lastSeenMain, lastSeenStrong } = computeRecency(rows);

  // Stats scores
  const expMain = expectedCountMain(nDraws);
  const expStrong = expectedCountStrong(nDraws);
  const chiMain = chiSquare(mainFreq, expMain);
  const chiStrong = chiSquare(strongFreq, expStrong);

  // Recommendations
  const lines = buildRecommendationLines(mainFreq, strongFreq, lastSeenMain, lastSeenStrong);

  // Gemini
  const apiKey = process.env.GEMINI_API_KEY;
  let geminiText = "";

  if (!apiKey) {
    console.log("Gemini API key not configured (GEMINI_API_KEY missing).");
  } else {
    const primaryModel = "gemini-2.5-flash";
    const fallbackModels = ["gemini-2.0-flash", "gemini-1.5-flash"];

    const prompt = buildGeminiPrompt({
      nDraws,
      latestDraw,
      hotMain,
      coldMain,
      hotStrong,
      coldStrong,
      chiMain,
      chiStrong,
      lines,
    });

    const tryModels = [primaryModel, ...fallbackModels];

    for (const m of tryModels) {
      try {
        geminiText = await geminiAnalyze({ model: m, apiKey, payloadText: prompt });
        console.log(`Gemini ok with model: ${m}`);
        break;
      } catch (e) {
        console.log(`Gemini failed with model ${m}: ${e.message}`);
      }
    }

    if (!geminiText) {
      console.log("Gemini analysis failed (all models).");
    }
  }

  const finalMessage = buildFinalMessage({
    nowIL,
    nDraws,
    latestDraw,
    hotMain,
    coldMain,
    hotStrong,
    coldStrong,
    lines,
    geminiText,
  });

  await sendTelegram(finalMessage);
  console.log("Sent Telegram message.");
}

main().catch(async (err) => {
  console.error("Job failed:", err?.message || err);
  // try to notify Telegram too (if configured)
  try {
    await sendTelegram(`❌ <b>Lotto Weekly AI</b>\nשגיאה:\n<code>${safeHtml(String(err?.message || err))}</code>`);
  } catch {}
  process.exit(1);
});
