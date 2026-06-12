const { GoogleGenAI } = require("@google/genai");

const client = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY
});

// Modelos lidos do .env (separados por virgula).
// Ex: GEMINI_CHAT_MODELS=gemini-2.5-flash,gemini-2.0-flash
// Se nao definido, usa os defaults abaixo.
const CHAT_MODELS = (process.env.GEMINI_CHAT_MODELS || "gemini-2.5-flash,gemini-2.0-flash")
  .split(",").map((m) => m.trim()).filter(Boolean);

const IMAGE_MODELS = (process.env.GEMINI_IMAGE_MODELS || "gemini-2.5-flash,gemini-2.0-flash")
  .split(",").map((m) => m.trim()).filter(Boolean);

console.log("Modelos de chat configurados:", CHAT_MODELS);
console.log("Modelos de imagem configurados:", IMAGE_MODELS);

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Converte array de mensagens em prompt de texto simples
function buildPrompt(messages) {
  return messages
    .map((msg) => {
      if (msg.role === "system") return `Sistema: ${msg.content}`;
      if (msg.role === "assistant") return `IA: ${msg.content}`;
      return `Usuario: ${msg.content}`;
    })
    .join("\n");
}

// Envia mensagens para o Gemini (sem streaming).
// Tenta cada modelo da lista CHAT_MODELS em sequencia.
async function sendToGemini(messages) {
  const prompt = buildPrompt(messages);

  console.log("Enviando para Gemini...");
  console.log("Quantidade de mensagens:", messages.length);
  console.log("Tamanho do prompt:", prompt.length);

  for (let i = 0; i < CHAT_MODELS.length; i++) {
    const model = CHAT_MODELS[i];
    const isLast = i === CHAT_MODELS.length - 1;

    try {
      console.log(`Tentando modelo: ${model}`);

      const response = await client.models.generateContent({
        model,
        contents: prompt
      });

      console.log(`Gemini respondeu OK com ${model}`);
      return response.text || "Sem resposta.";

    } catch (error) {
      console.error(`Erro com ${model}:`, error.message);

      if (isLast) {
        throw new Error(error.message || "Erro ao consultar Gemini.");
      }

      console.log("Tentando proximo modelo...");
    }
  }
}

// Envia mensagens para o Gemini com streaming (SSE).
// Chama onChunk para cada trecho de texto recebido.
// Tenta cada modelo da lista CHAT_MODELS em sequencia.
async function sendToGeminiStream(messages, onChunk) {
  const prompt = buildPrompt(messages);

  console.log("Iniciando stream Gemini...");

  for (let i = 0; i < CHAT_MODELS.length; i++) {
    const model = CHAT_MODELS[i];
    const isLast = i === CHAT_MODELS.length - 1;

    try {
      console.log(`Stream tentando modelo: ${model}`);

      const stream = await client.models.generateContentStream({
        model,
        contents: prompt
      });

      let fullText = "";

      for await (const chunk of stream) {
        const text = chunk.text || "";
        if (text) {
          fullText += text;
          onChunk(text);
        }
      }

      console.log(`Stream concluido com ${model}`);
      return fullText;

    } catch (error) {
      console.error(`Stream falhou com ${model}:`, error.message);

      if (isLast) {
        throw new Error(error.message || "Erro ao gerar resposta com Gemini.");
      }

      console.log("Tentando proximo modelo...");
    }
  }
}

module.exports = { sendToGemini, sendToGeminiStream, CHAT_MODELS, IMAGE_MODELS };
