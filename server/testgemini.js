require('dotenv').config();
const { GoogleGenAI } = require('@google/genai');
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function test() {
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: "Return a tiny JSON object saying {" + "\"hi\": 1" + "}. Do not include markdown.",
      config: {
        responseMimeType: "application/json",
      }
    });
    console.log("Raw text:", response.text);
    console.log("Parsed:", JSON.parse(response.text));
  } catch (error) {
    console.error("ERROR", error.message);
  }
}
test();
