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

  // Máximo de tentativas
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) { // tenta até 3 vezes em caso de erro temporário
    try {

      // 🔥 PRIMEIRA TENTATIVA (modelo principal FREE)
      const response = await client.models.generateContent({
        model: "gemini-2.5-flash-lite", // 🏆 melhor escolha gratuita
        contents: prompt
      });

      return response.text || "Sem resposta.";

    } catch (error) {
      const errorText = error.message || "";

      const isTemporary =
        errorText.includes("503") ||
        errorText.includes("UNAVAILABLE") ||
        errorText.includes("high demand");

      // Se não for erro temporário, tenta fallback direto
      if (!isTemporary) {
        console.log("Tentando fallback para modelo secundário...");

        const fallbackResponse = await client.models.generateContent({
          model: "gemini-2.5-flash", // fallback mais forte
          contents: prompt
        });

        return fallbackResponse.text || "Sem resposta.";
      }

      // Se chegou no limite de tentativas
      if (attempt === maxAttempts) {
        throw new Error(
          "Gemini está com alta demanda. Tente novamente em alguns segundos."
        );
      }

      // Espera antes de tentar novamente
      await delay(1500 * attempt);
    }
  }
}

// Exporta a função
module.exports = { sendToGemini };