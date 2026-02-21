import { GoogleGenerativeAI } from "@google/genai";

export async function askGemini(data) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("Missing GEMINI_API_KEY");

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

  const prompt = `
אתה אנליסט לוטו.
על בסיס הנתונים הבאים תן 3 סטים של 6 מספרים (1-37) ומספר חזק (1-7).
ענה רק ב JSON.

${JSON.stringify(data)}
`;

  const result = await model.generateContent(prompt);
  return result.response.text();
}
