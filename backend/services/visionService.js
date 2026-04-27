// ============================================================
// SERVIÇO DE ANÁLISE DE IMAGENS (OCR) - AdaptIA
// ============================================================
// Este serviço usa o Gemini para analisar imagens:
// extrair textos visíveis (OCR), descrever o conteúdo,
// e responder perguntas sobre a imagem.
// ============================================================

// ----------------------------------------------------------
// IMPORTAÇÕES
// ----------------------------------------------------------

// GoogleGenAI: Biblioteca oficial do Google para acessar
// os modelos Gemini (que têm capacidade de visão)
const { GoogleGenAI } = require("@google/genai");

// fs (File System): Módulo nativo do Node.js para ler
// arquivos de imagem do sistema
const fs = require("fs");

// mime-types: Biblioteca para detectar o tipo MIME
// de arquivos baseado na extensão (jpg, png, webp, etc)
const mime = require("mime-types");

// ----------------------------------------------------------
// CRIAÇÃO DO CLIENTE GEMINI
// ----------------------------------------------------------

// Inicializa o cliente com a API Key do arquivo .env
const client = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY
});

// ----------------------------------------------------------
// FUNÇÃO PRINCIPAL: ANALISAR IMAGEM COM GEMINI
// ----------------------------------------------------------
// Recebe uma imagem e uma mensagem opcional, envia para
// o Gemini com capacidades de visão e retorna a análise.

async function analyzeImageWithGemini(file, message) {

  // --------------------------------------------------------
  // DETECÇÃO DO TIPO MIME DA IMAGEM
  // --------------------------------------------------------
  // Tenta detectar o tipo MIME usando a biblioteca mime-types
  // Fallback para o mimeType do arquivo enviado
  const mimeType = mime.lookup(file.originalname) || file.mimetype;

  // --------------------------------------------------------
  // CONVERSÃO DA IMAGEM PARA BASE64
  // --------------------------------------------------------
  // Lê a imagem como binário e converte para texto base64
  // A API do Gemini aceita imagens como dados inline base64
  const imageBase64 = fs.readFileSync(file.path).toString("base64");

  console.log("Enviando imagem para Gemini (OCR)...");

  // --------------------------------------------------------
  // ENVIO PARA A API DO GEMINI COM VISÃO
  // --------------------------------------------------------
  const response = await client.models.generateContent({
    // Modelo: Gemini 2.5 Flash Lite (suporta visão)
    model: "gemini-2.5-flash-lite",

    // Conteúdo: texto de instrução + dados da imagem
    contents: [
      {
        role: "user",
        parts: [
          {
            // Instruções detalhadas para análise da imagem
            text: `
Analise esta imagem.

Tarefas:
1. Descreva o que aparece na imagem.
2. Se houver texto visível, transcreva-o (OCR).
3. Organize o conteúdo encontrado.
4. Responda a pergunta do usuário se houver.

Pergunta:
${message || "Analise a imagem."}
            `.trim()
          },
          {
            // Dados da imagem codificada em base64
            // inlineData indica que são dados inline (não URL)
            inlineData: {
              mimeType, // tipo da imagem (image/png, image/jpeg, etc)
              data: imageBase64 // conteúdo codificado da imagem
            }
          }
        ]
      }
    ]
  });

  console.log("Imagem analisada OK");

  // Retorna o texto da resposta ou mensagem padrão
  return response.text || "Não consegui analisar a imagem.";
}

// ----------------------------------------------------------
// EXPORTAÇÃO
// ----------------------------------------------------------
// Exporta a função para ser usada em server.js

module.exports = { analyzeImageWithGemini };