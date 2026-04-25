// ===============================
// 📄 SERVICE PARA ANALISAR PDF COMPLETO (OCR + TEXTO)
// ===============================

// Importa biblioteca oficial do Gemini
const { GoogleGenAI } = require("@google/genai");

// fs → usado para ler arquivos do sistema
const fs = require("fs");

// Cria cliente Gemini usando API KEY do .env
const client = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY
});

// Função que envia PDF completo para o Gemini
async function analyzePdfWithGemini(file, message) {

  // Lê o PDF e converte para base64
  const pdfBase64 = fs.readFileSync(file.path).toString("base64");

  console.log("Enviando PDF completo para Gemini...");

  // Envia o PDF + instruções para IA
  const response = await client.models.generateContent({
    model: "gemini-2.5-flash-lite",

    contents: [
      {
        role: "user",
        parts: [
          {
            text: `
Analise este PDF completamente.

Tarefas:
1. Leia textos digitáveis e textos presentes em imagens (OCR).
2. Identifique tabelas, listas, dados e informações importantes.
3. Se for currículo → analise profissional.
4. Se for lista → organize os itens.
5. Se for documento visual → descreva.
6. Responda em português de forma clara.

Pergunta do usuário:
${message || "Analise este PDF."}
            `.trim()
          },
          {
            // 🔥 Aqui vai o PDF em base64
            inlineData: {
              mimeType: "application/pdf",
              data: pdfBase64
            }
          }
        ]
      }
    ]
  });

  console.log("Resposta do Gemini recebida");

  return response.text || "Não consegui analisar o PDF.";
}

module.exports = { analyzePdfWithGemini };