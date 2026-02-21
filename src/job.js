import { askGemini } from "./gemini.js";
import { sendTelegram } from "./telegram.js";

async function run() {
  const dummyData = {
    hot: [5, 12, 18, 22, 31, 7],
    cold: [1, 3, 9, 14, 27, 35]
  };

  const gemini = await askGemini(dummyData);

  const message = `
🔥 חמים:
${dummyData.hot.join(", ")}

🧊 קרים:
${dummyData.cold.join(", ")}

🧠 Gemini:
${gemini}
`;

  await sendTelegram(message);
}

run();
