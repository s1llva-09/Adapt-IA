// ===============================
// 🖼️ SERVICE PARA ANALISAR IMAGEM (OCR)
// ===============================

const { GoogleGenAI } = require("@google/genai");
const fs = require("fs");
const mime = require("mime-types");

const client = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY
});

// Analisa imagem com OCR + descrição
async function analyzeImageWithGemini(file, message) {

  // Descobre o tipo da imagem
  const mimeType = mime.lookup(file.originalname) || file.mimetype;

  // Converte imagem para base64
  const imageBase64 = fs.readFileSync(file.path).toString("base64");

  console.log("Enviando imagem para Gemini (OCR)...");

  const response = await client.models.generateContent({
    model: "gemini-2.5-flash-lite",

    contents: [
      {
        role: "user",
        parts: [
          {
            text: `
Analise esta imagem.

Tarefas:
1. Descreva o que aparece.
2. Se houver texto, transcreva (OCR).
3. Organize o conteúdo.
4. Responda a pergunta do usuário.

Pergunta:
${message || "Analise a imagem."}
            `.trim()
          },
          {
            inlineData: {
              mimeType,
              data: imageBase64
            }
          }
        ]
      }
    ]
  });

  console.log("Imagem analisada OK");

  return response.text || "Não consegui analisar a imagem.";
}

module.exports = { analyzeImageWithGemini };