// Importa a biblioteca oficial do Gemini
const { GoogleGenAI } = require("@google/genai");

// Cria o cliente usando a API KEY do .env
const client = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY
});

// Função para esperar alguns milissegundos (usado no retry)
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Função principal que envia mensagens para o Gemini
async function sendToGemini(messages) {

  // Converte o histórico em texto simples
  const prompt = messages
    .map((msg) => {
      if (msg.role === "system") return `Sistema: ${msg.content}`;
      if (msg.role === "assistant") return `IA: ${msg.content}`;
      return `Usuário: ${msg.content}`;
    })
    .join("\n");

  // Debug para saber se o prompt está muito grande
  console.log("Enviando para Gemini...");
  console.log("Quantidade de mensagens:", messages.length);
  console.log("Tamanho do prompt:", prompt.length);

  // Máximo de tentativas
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      console.log(`Tentativa Gemini ${attempt}/${maxAttempts}`);

      const response = await client.models.generateContent({
        model: "gemini-2.5-flash-lite",
        contents: prompt
      });

      console.log("Gemini respondeu OK");

      return response.text || "Sem resposta.";
    } catch (error) {
      console.error("Erro no Gemini:", error);

      const errorText = error.message || "";

      const isTemporary =
        errorText.includes("503") ||
        errorText.includes("UNAVAILABLE") ||
        errorText.includes("high demand");

      if (!isTemporary) {
        console.log("Tentando fallback para modelo secundário...");

        try {
          const fallbackResponse = await client.models.generateContent({
            model: "gemini-2.5-flash",
            contents: prompt
          });

          console.log("Fallback Gemini respondeu OK");

          return fallbackResponse.text || "Sem resposta.";
        } catch (fallbackError) {
          console.error("Erro no fallback Gemini:", fallbackError);
          throw new Error(fallbackError.message || "Erro ao consultar Gemini.");
        }
      }

      if (attempt === maxAttempts) {
        throw new Error(
          "Gemini está com alta demanda. Tente novamente em alguns segundos."
        );
      }

      await delay(1500 * attempt);
    }
  }
}

// Exporta a função
module.exports = { sendToGemini };