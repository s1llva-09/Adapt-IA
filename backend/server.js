// Importa o Express para criar o servidor
const express = require("express");

// Importa o CORS para permitir chamadas do front-end
const cors = require("cors");

//Permite o servidor receber arquivos enviados pelo usuário
const multer = require("multer") //recebe arquivos

//Importa um módulo nativo do Node.js
//Ajuda a trabalhar com caminhos e arquivos
const path = require("path") //manipula eles

// Carrega as variáveis de ambiente do arquivo .env dentro de backend/
require("dotenv").config({ path: "./backend/.env" });

// Importa os serviços que falam com OpenAI e Gemini
const { sendToOpenAI } = require("./services/openaiService");
const { sendToGemini } = require("./services/geminiService");

//importa os serviços de analise de imagem tanto com o gemini quanto com a biblioteca instalada
const { extractFileContent, isImageFile } = require("./services/fileService")
const { analyzeImageWithGemini } = require("./services/visionService")

// Cria a aplicação
const app = express();

// Middlewares
app.use(cors());
app.use(express.json());

//configura o multer para salvar arquivos temporariamente em backend / uploads
const upload = multer ({
  dest: path.join(__dirname, "uploads"),
  limits: {
    fileSize: 15 * 1024 * 1024
  }
})

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

app.post("/upload", upload.single("file"), async (req, res) => {
  try {
    const { provider, message = "Analise este arquivos.", history = "[]" } = req.body

    if (!req.file) {
      return res.status(400).json({
        reply: "Nenhum arquivo foi enviado"
      })
    }

    const parsedHistory = JSON.parse(history)

    let reply

    //se for imagem usa o gemini multimodal
    if(isImageFile(req.file)) {
      reply = await analyzeImageWithGemini(req.file, message)

      return res.json({
        reply,
        fileName: req.file.originalname
      })
    }

    //se for document/text/codigo, extrai o conteudo
    const filecontent = await extractFileContent(req.file) 

      const systemPrompt = {
        role: "system",
        content: getSystemPrompt()
    }

    const fileMessage = {
      role: "user",
      content: `
      Mensagem do usuario:
      ${message}

      Arquivo enviado:
      ${req.file.originalname}

      Conteúdo extraído do arquivo:
      ${filecontent}
        `.trim()
    }

    const messages = [systemPrompt, ...parsedHistory, fileMessage]

    if(provider === "openai") {
      try {
        reply = await sendToOpenAI(messages)
      } catch (error) {
        console.log("OpenAi falhou no upload, usando Gemini...")
        reply = await sendToGemini(messages)
      }
    }else {
      reply = await sendToGemini(messages)
    }

    return res.json({
      reply,
      fileName: req.file.originalname
    })
  } catch(error) {
    console.log("Erro no /upload:", error)

    return res.status(500).json({
      reply: "Erro ao processar o arquivo",
      error: error.message
    })
  }
})

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