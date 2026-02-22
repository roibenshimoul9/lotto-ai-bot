import fs from "fs";
import axios from "axios";
import { analyzeWithGemini } from "./gemini.js";

async function sendToTelegram(message) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.log("Telegram not configured");
    return;
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  await axios.post(url, {
    chat_id: chatId,
    text: message
  });
}

async function run() {
  const history = JSON.parse(
    fs.readFileSync("data/history.json", "utf-8")
  );

  const aiResult = await analyzeWithGemini(history);

  console.log(aiResult);

  await sendToTelegram(`🎯 AI Lotto Analysis:\n\n${aiResult}`);
}

run();
