import axios from "axios";

// ===== הגרלת מספרים ללא כפילויות =====
function drawUniqueNumbers(count, max) {
  const numbers = new Set();

  while (numbers.size < count) {
    const num = Math.floor(Math.random() * max) + 1;
    numbers.add(num);
  }

  return Array.from(numbers).sort((a, b) => a - b);
}

// ===== יצירת תוצאה =====
function generateLotto() {
  const main = drawUniqueNumbers(3, 37);
  const strong = drawUniqueNumbers(3, 7);

  return {
    date: new Date().toISOString(),
    mainNumbers: main,
    strongNumbers: strong
  };
}

// ===== שליחת טלגרם (אופציונלי) =====
async function sendToTelegram(message) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.log("Telegram not configured.");
    return;
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  await axios.post(url, {
    chat_id: chatId,
    text: message
  });
}

// ===== ריצה =====
async function run() {
  const result = generateLotto();

  console.log("Generated Lotto:");
  console.log(JSON.stringify(result, null, 2));

  const message = `
🎯 Lotto Prediction
-----------------------
Main: ${result.mainNumbers.join(", ")}
Strong: ${result.strongNumbers.join(", ")}
`;

  await sendToTelegram(message);
}

run();
