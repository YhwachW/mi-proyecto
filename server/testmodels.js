require('dotenv').config();
const { GoogleGenAI } = require('@google/genai');
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
async function testModel(modelName) {
  try {
    const res = await ai.models.generateContent({
      model: modelName,
      contents: "Hi"
    });
    console.log(`✅ ${modelName} worked:`, res.text);
  } catch (err) {
    console.log(`❌ ${modelName} failed:`, err.status, err.message);
  }
}
async function run() {
  await testModel('gemini-1.5-flash-8b');
  await testModel('gemini-flash-latest');
  await testModel('gemini-1.5-flash');
}
run();
