import axios from "axios";

export async function askGemini(data) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("Missing GEMINI_API_KEY");

  const prompt = `
אתה אנליסט לוטו.
על בסיס הנתונים הבאים תן 3 סטים של 6 מספרים (1-37) ומספר חזק (1-7).
ענה רק ב JSON.

${JSON.stringify(data)}
`;

  const response = await axios.post(
    `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
    {
      contents: [
        {
          parts: [
            { text: prompt }
          ]
        }
      ]
    }
  );

  return response.data.candidates[0].content.parts[0].text;
}
