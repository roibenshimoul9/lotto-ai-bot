import axios from "axios";
import fs from "fs";
import puppeteer from "puppeteer";

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// ---------------- TELEGRAM ----------------

async function sendTelegram(text) {
  await axios.post(
    `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`,
    {
      chat_id: TELEGRAM_CHAT_ID,
      text,
    }
  );
}

// ---------------- GET LAST SAVED DRAW ----------------

function getLastSavedDrawNumber() {
  if (!fs.existsSync("data/Lotto.csv")) return 0;

  const raw = fs.readFileSync("data/Lotto.csv", "utf8");
  const lines = raw.trim().split("\n");

  if (lines.length === 0) return 0;

  const lastLine = lines[lines.length - 1];
  return Number(lastLine.split(",")[0]);
}

// ---------------- APPEND TO CSV ----------------

function appendDraw(draw) {
  const line = `${draw.draw},${draw.date},${draw.main.join(",")},${draw.strong},0,0,\n`;
  fs.appendFileSync("data/Lotto.csv", line);
}

// ---------------- SCRAPE FROM PAIS ----------------

async function fetchLatestDraw() {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  const page = await browser.newPage();
  await page.goto("https://www.pais.co.il/lotto/", {
    waitUntil: "networkidle2"
  });

  // מחכה לטעינת המספרים
  await page.waitForTimeout(3000);

  const result = await page.evaluate(() => {

    // הכדורים האדומים
    const balls = Array.from(
      document.querySelectorAll(".results-area .ball, .results-area .red-ball")
    ).map(el => Number(el.innerText.trim()))
     .filter(n => !isNaN(n));

    // הכדור החזק (כחול)
    const strongBallEl =
      document.querySelector(".results-area .blue-ball");

    const strongBall = strongBallEl
      ? Number(strongBallEl.innerText.trim())
      : null;

    // מספר הגרלה מתוך הטקסט
    const match = document.body.innerText.match(/לוטו מס׳\s*(\d+)/);
    const drawNumber = match ? Number(match[1]) : Date.now();

    return {
      draw: drawNumber,
      date: new Date().toLocaleDateString("he-IL"),
      main: balls.slice(0, 6),
      strong: strongBall
    };
  });

  await browser.close();

  if (!result.main || result.main.length < 6) {
    throw new Error("Failed to scrape lotto numbers");
  }

  return result;
}

// ---------------- MAIN ----------------

async function run() {
  try {
    console.log("Checking latest lotto draw...");

    const latest = await fetchLatestDraw();
    const lastSaved = getLastSavedDrawNumber();

    console.log("Latest draw:", latest.draw);
    console.log("Last saved:", lastSaved);

    if (latest.draw > lastSaved) {

      appendDraw(latest);

      await sendTelegram(
        `✅ New Lotto Draw Added\n\n` +
        `Draw #${latest.draw}\n` +
        `Numbers: ${latest.main.join(", ")}\n` +
        `Strong: ${latest.strong}`
      );

      console.log("New draw saved.");

    } else {

      await sendTelegram("ℹ️ No new lotto draw.");
      console.log("No new draw found.");

    }

  } catch (err) {
    console.error(err);
    await sendTelegram("❌ Failed to fetch lotto.");
  }
}

run();
