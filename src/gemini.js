import axios from "axios";

export async function askGemini(data) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("Missing GEMINI_API_KEY");

  const prompt = `
אתה אנליסט לוטו.
על סמך הנתונים הבאים בחר 3 מספרים בטווח 1-37 ו-3 מספרים בטווח 1-7.
ענה אך ורק JSON תקין.

${JSON.stringify(data)}
`;

  const response = await axios.post(
    "https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent",
    {
      contents: [
        {
          parts: [{ text: prompt }]
        }
      ]
    },
    {
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey
      }
    }
  );

  return response.data.candidates[0].content.parts[0].text;
}
