import axios from "axios";

export async function sendTelegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.ADMIN_CHAT_ID;

  if (!token || !chat) {
    throw new Error("Missing Telegram secrets");
  }

  await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
    chat_id: chat,
    text
  });
}
