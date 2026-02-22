import axios from "axios";

export async function analyzeWithGemini(history) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("Missing GEMINI_API_KEY");

  const prompt = `
אתה Data Scientist המתמחה בניתוח לוטו.

נתח את ההיסטוריה הבאה:
- מצא מספרים חמים
- מצא מספרים קרים
- נתח דפוסי זוגי/אי זוגי
- נתח פיזור טווחים

בסוף החזר אך ורק JSON בפורמט:

{
  "hot_numbers": [],
  "cold_numbers": [],
  "pattern_analysis": "",
  "recommended": {
    "main": [],
    "strong": []
  }
}

הנתונים:
${JSON.stringify(history)}
`;

  const response = await axios.post(
    "https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent",
    {
      contents: [
        { parts: [{ text: prompt }] }
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
