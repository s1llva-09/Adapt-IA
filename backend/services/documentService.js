// ============================================================
// SERVIÇO DE ANÁLISE DE PDF - AdaptIA
// ============================================================
// Este serviço é responsável por enviar PDFs completos para
// o Gemini e receber a análise completa com OCR do documento.
// ============================================================

// ----------------------------------------------------------
// IMPORTAÇÕES
// ----------------------------------------------------------

// GoogleGenAI: Biblioteca oficial do Google para acessar
// os modelos Gemini (mesma API usada pelo Google AI Studio)
const { GoogleGenAI } = require("@google/genai");
const fs = require("fs");

const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const MODEL = (process.env.GEMINI_IMAGE_MODELS || "gemini-2.5-flash").split(",")[0].trim();

// ----------------------------------------------------------
// FUNÇÃO PRINCIPAL: ANALISAR PDF COM GEMINI
// ----------------------------------------------------------
// Recebe: arquivo do PDF e mensagem opcional do usuário
// Retorna: texto com a análise completa do documento

async function analyzePdfWithGemini(file, message) {

  // --------------------------------------------------------
  // CONVERSÃO DO PDF PARA BASE64
  // --------------------------------------------------------
  // O PDF é lido como binário e convertido para base64
  // Base64 é necessário porque a API do Gemini aceita
  // arquivos como texto codificado
  const pdfBase64 = fs.readFileSync(file.path).toString("base64");

  console.log("Enviando PDF completo para Gemini...");

  // --------------------------------------------------------
  // ENVIO PARA A API DO GEMINI
  // --------------------------------------------------------
  // Envia o PDF codificado + instrução de análise
  const response = await client.models.generateContent({
    // Modelo utilizado: Gemini 2.5 Flash Lite (rápido e barato)
    model: MODEL,

    // Conteúdo da mensagem: instruções + arquivo em anexo
    contents: [
      {
        role: "user",
        parts: [
          {
            // Instruções detalhadas para a IA sobre como analisar
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
            // O PDF em si, codificado em base64
            // inlineData indica que é um arquivo inline (não uma URL)
            inlineData: {
              mimeType: "application/pdf", // tipo do arquivo
              data: pdfBase64 // conteúdo codificado
            }
          }
        ]
      }
    ]
  });

  console.log("Resposta do Gemini recebida");

  // Retorna o texto da resposta ou mensagem padrão se vazio
  return response.text || "Não consegui analisar o PDF.";
}

// ----------------------------------------------------------
// EXPORTAÇÃO
// ----------------------------------------------------------
// Exporta a função para ser usada em outros arquivos
// (principalmente em server.js na rota /upload)

module.exports = { analyzePdfWithGemini };