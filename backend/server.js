// Importa o Express para criar o servidor
const express = require("express");

// Importa o CORS para permitir chamadas do front-end
const cors = require("cors");

// Carrega as variáveis de ambiente do arquivo .env dentro de backend/
require("dotenv").config({ path: "./backend/.env" });

// Importa os serviços que falam com OpenAI e Gemini
const { sendToOpenAI } = require("./services/openaiService");
const { sendToGemini } = require("./services/geminiService");

// Cria a aplicação
const app = express();

// Middlewares
app.use(cors());
app.use(express.json());

// Logs úteis para conferir se as chaves foram carregadas
console.log("OPENAI:", process.env.OPENAI_API_KEY ? "OK" : "NÃO ENCONTRADA");
console.log("GEMINI:", process.env.GEMINI_API_KEY ? "OK" : "NÃO ENCONTRADA");

// Prompt-base do sistema
function getSystemPrompt() {
  return `
Você é um assistente inteligente e adaptável.

Regras:
- Entenda o contexto pela conversa.
- Se o usuário falar de programação, responda como especialista.
- Se mudar de assunto, adapte-se ao novo contexto.
- Responda sempre no idioma do usuário.
- Seja claro, natural e útil.
  `.trim();
}

// Rota principal do chat
app.post("/chat", async (req, res) => {
  try {
    const { provider, message, history = [] } = req.body;

    // Log de entrada para debug
    console.log("Provider recebido:", provider);
    console.log("Message recebida:", message);
    console.log("History recebida:", history);

    // Validação básica
    if (!provider || !message) {
      return res.status(400).json({
        reply: "Dados inválidos. provider e message são obrigatórios."
      });
    }

    // Cria a mensagem de sistema
    const systemPrompt = {
      role: "system",
      content: getSystemPrompt()
    };

    // Junta o prompt do sistema com o histórico
    const messages = [systemPrompt, ...history];

    console.log("Messages montadas:", messages);

    let reply;

    if (provider === "openai") {
      try {
        reply = await sendToOpenAI(messages);
      } catch (error) {
        console.log("OpenAI falhou, usando Gemini...");
        console.error("Erro OpenAI:", error.message);

        reply = await sendToGemini(messages);
      }
    } else if (provider === "gemini") {
      reply = await sendToGemini(messages);
    } else {
      return res.status(400).json({
        reply: "Provedor desconhecido. Escolha 'openai' ou 'gemini'."
      });
    }

    return res.json({ reply });
  } catch (error) {
    console.error("Erro no /chat:", error);

    return res.status(500).json({
      reply: "Erro ao consultar a IA.",
      error: error.message
    });
  }
});

// Porta do servidor
const PORT = process.env.PORT || 3000;

// Sobe o servidor
app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});