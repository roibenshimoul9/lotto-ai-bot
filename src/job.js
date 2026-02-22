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
  try {
    await axios.post(`https://api.telegram.org/bot${BOT}/sendMessage`, {
      chat_id: CHAT,
      text,
      disable_web_page_preview: true
    });
  } catch (err) {
    console.log("Telegram error:", err.message);
  }
}

/* ================= CSV HELPERS ================= */

function readCSV() {
  if (!fs.existsSync(CSV_PATH)) return [];
  return fs.readFileSync(CSV_PATH, "utf8")
    .split("\n")
    .filter(Boolean);
}

function writeCSV(lines) {
  const trimmed = lines.slice(0, KEEP_LAST);
  fs.writeFileSync(CSV_PATH, trimmed.join("\n") + "\n");
}

function drawExists(drawNumber, lines) {
  return lines.some(line => line.startsWith(drawNumber + ","));
}

function getHighestDraw(lines) {
  let max = 0;
  for (const line of lines) {
    const num = Number(line.split(",")[0]);
    if (num > max) max = num;
  }
  return max;
}

/* ================= FETCH FROM PAIS ARCHIVE ================= */
/*
אנחנו לא גורדים HTML.
במקום זה נשתמש ב-POSTBACK של ASP.NET כדי למשוך תוצאה לפי מספר הגרלה.
*/

async function fetchDrawFromPais(drawNumber) {
  try {
    const url = "https://www.pais.co.il/lotto/archive.aspx";

    const res = await axios.post(url, new URLSearchParams({
      drawNumber: drawNumber
    }), {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      }
    });

    const html = res.data;

    const matches = [...html.matchAll(/class="ball[^"]*">(\d+)<\/span>/g)];

    if (matches.length < 7) return null;

    const nums = matches.map(m => Number(m[1]));

    return {
      drawNumber,
      main: nums.slice(0,6),
      strong: nums[6]
    };

  } catch (err) {
    console.log("Pais fetch failed:", err.message);
    return null;
  }
}

/* ================= FALLBACK ================= */

async function fetchDrawFallback(drawNumber) {
  try {
    const url = `https://lotteryguru.com/israel-lottery-results`;
    const res = await axios.get(url);
    const html = res.data;

    if (!html.includes(drawNumber)) return null;

    const matches = [...html.matchAll(/class="ball[^"]*">(\d+)<\/span>/g)];

    if (matches.length < 7) return null;

    const nums = matches.map(m => Number(m[1]));

    return {
      drawNumber,
      main: nums.slice(0,6),
      strong: nums[6]
    };

  } catch (err) {
    console.log("Fallback failed:", err.message);
    return null;
  }
}

/* ================= MAIN ================= */

async function main() {

  const lines = readCSV();
  const highest = getHighestDraw(lines);

  if (!highest) {
    console.log("No previous draw found in CSV.");
    return;
  }

  const nextDraw = highest + 1;
  console.log("Checking draw:", nextDraw);

  let result = await fetchDrawFromPais(nextDraw);

  if (!result) {
    console.log("Primary source failed. Trying fallback...");
    result = await fetchDrawFallback(nextDraw);
  }

  if (!result) {
    console.log("No new draw found.");
    return;
  }

  if (drawExists(result.drawNumber, lines)) {
    console.log("Draw already exists. Skipping.");
    return;
  }

  const newLine =
    `${result.drawNumber},${result.main.join(",")},${result.strong}`;

  const updated = [newLine, ...lines];

  writeCSV(updated);

  await sendTelegram(
    `📢 הגרלה חדשה נוספה!\n#${result.drawNumber}\n${result.main.join(", ")} | חזק: ${result.strong}`
  );

  console.log("New draw saved successfully.");
}

main().catch(err => {
  console.error("Fatal error:", err.message);
});
