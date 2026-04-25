const express = require("express");
const cors = require("cors");
const fs = require("fs");
const multer = require("multer");
const path = require("path");

// Carrega as variaveis do backend antes de inicializar os clientes das IAs.
require("dotenv").config({ path: "./backend/.env" });

// Servicos de texto e de arquivo usados pelas rotas abaixo.
const { sendToOpenAI } = require("./services/openaiService");
const { sendToGemini } = require("./services/geminiService");
const { extractFileContent, isImageFile } = require("./services/fileService");
const { analyzeImageWithGemini } = require("./services/visionService");

const app = express();

// Libera chamadas do front-end e permite receber JSON nas rotas de chat.
app.use(cors());
app.use(express.json());

// Log simples de requisicoes para facilitar debug.
app.use((req, res, next) => {
  const startedAt = Date.now();

  res.on("finish", () => {
    const duration = Date.now() - startedAt;
    console.log(`[http] ${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`);
  });

  next();
});

// O Multer salva o upload temporariamente em backend/uploads e protege o servidor
// com um limite maximo de tamanho por arquivo.
const upload = multer({
  dest: path.join(__dirname, "uploads"),
  limits: {
    fileSize: 15 * 1024 * 1024
  }
});

console.log("OPENAI:", process.env.OPENAI_API_KEY ? "OK" : "NAO ENCONTRADA");
console.log("GEMINI:", process.env.GEMINI_API_KEY ? "OK" : "NAO ENCONTRADA");

function getSystemPrompt() {
  // Prompt base usado nas conversas de texto e tambem no fluxo de upload de documentos.
  return `
Voce e um assistente inteligente e adaptavel.

Regras:
- Entenda o contexto pela conversa.
- Se o usuario falar de programacao, responda como especialista.
- Se mudar de assunto, adapte-se ao novo contexto.
- Responda sempre no idioma do usuario.
- Seja claro, natural e util.
  `.trim();
}

app.get("/health", (req, res) => {
  return res.json({
    status: "ok",
    service: "adapt-ia-backend"
  });
});

function normalizeHistory(history) {
  if (!Array.isArray(history)) return [];

  return history.filter((item) => {
    return (
      item &&
      typeof item === "object" &&
      ["user", "assistant", "system"].includes(item.role) &&
      typeof item.content === "string"
    );
  });
}

app.post("/upload", upload.single("file"), async (req, res) => {
  try {
    // O front envia provider, mensagem opcional, historico serializado e o arquivo.
    const { provider, message = "Analise este arquivo.", history = "[]" } = req.body;

    if (!req.file) {
      return res.status(400).json({
        reply: "Nenhum arquivo foi enviado"
      });
    }

    const parsedHistory = JSON.parse(history);
    let reply;

    if (isImageFile(req.file)) {
      // Imagens seguem para o servico multimodal. Hoje esse fluxo usa Gemini.
      reply = await analyzeImageWithGemini(req.file, message);

      return res.json({
        reply,
        fileName: req.file.originalname
      });
    }

    // Arquivos de texto, PDF e DOCX tem o conteudo extraido e anexado ao prompt.
    const fileContent = await extractFileContent(req.file);
    const systemPrompt = {
      role: "system",
      content: getSystemPrompt()
    };

    const fileMessage = {
      role: "user",
      content: `
      Mensagem do usuario:
      ${message}

      Arquivo enviado:
      ${req.file.originalname}

      Conteudo extraido do arquivo:
      ${fileContent}
      `.trim()
    };

    const messages = [systemPrompt, ...parsedHistory, fileMessage];

    if (provider === "openai") {
      try {
        // Mantem a preferencia do usuario pelo provider escolhido.
        reply = await sendToOpenAI(messages);
      } catch (error) {
        // Se OpenAI falhar, tenta Gemini para nao perder a resposta.
        console.log("OpenAI falhou no upload, usando Gemini...");
        reply = await sendToGemini(messages);
      }
    } else {
      reply = await sendToGemini(messages);
    }

    return res.json({
      reply,
      fileName: req.file.originalname
    });
  } catch (error) {
    console.log("Erro no /upload:", error);

    // Alguns erros sao causados pelo proprio arquivo enviado, entao retornamos 400.
    const isClientUploadError =
      error instanceof SyntaxError ||
      error.status === 429 ||
      error.message?.includes("Nao foi possivel analisar essa imagem") ||
      error.message?.includes("nao foi reconhecido como uma imagem valida");

    const statusCode = error.status || (isClientUploadError ? 400 : 500);

    return res.status(statusCode).json({
      reply: isClientUploadError ? error.message : "Erro ao processar o arquivo",
      error: error.message
    });
  } finally {
    // Remove o arquivo temporario salvo pelo Multer para nao acumular lixo em disco.
    if (req.file?.path) {
      fs.promises.unlink(req.file.path).catch(() => {});
    }
  }
});

app.post("/chat", async (req, res) => {
  try {
    // No chat comum recebemos apenas texto e historico da conversa.
    const { provider, message, history = [] } = req.body;

    console.log("Provider recebido:", provider);
    console.log("Message recebida:", message);
    console.log("History recebida:", history);

    if (!provider || !message) {
      return res.status(400).json({
        reply: "Dados invalidos. provider e message sao obrigatorios."
      });
    }

    const systemPrompt = {
      role: "system",
      content: getSystemPrompt()
    };

    // O front normalmente envia o historico ja com a mensagem atual.
    // Mesmo assim, tratamos os dois cenarios:
    // 1) history ja contem a mensagem atual do usuario
    // 2) history vem vazio e a mensagem atual chega apenas em "message"
    const normalizedHistory = normalizeHistory(history);
    const normalizedMessage = String(message || "").trim();
    const lastHistoryItem = normalizedHistory[normalizedHistory.length - 1];
    const shouldAppendMessage =
      !!normalizedMessage &&
      !(
        lastHistoryItem?.role === "user" &&
        lastHistoryItem?.content?.trim() === normalizedMessage
      );

    const messages = shouldAppendMessage
      ? [...normalizedHistory, { role: "user", content: normalizedMessage }]
      : normalizedHistory;

    // O prompt de sistema entra sempre como primeira instrução.
    messages.unshift(systemPrompt);

    console.log("Messages montadas:", messages);

    let reply;

    if (provider === "openai") {
      try {
        reply = await sendToOpenAI(messages);
      } catch (error) {
        // Fallback para Gemini caso OpenAI esteja indisponivel ou retorne erro.
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

    if (error.status === 429) {
      return res.status(429).json({
        reply: error.message,
        error: error.message
      });
    }

    return res.status(500).json({
      reply: "Erro ao consultar a IA.",
      error: error.message
    });
  }
});

app.use((error, req, res, next) => {
  // Trata erros do Multer fora do try/catch da rota, como arquivo acima do limite.
  if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
    return res.status(400).json({
      reply: "O arquivo ultrapassa o limite de 15 MB."
    });
  }

  next(error);
});

const PORT = process.env.PORT || 3000;

// Inicializa o servidor HTTP do backend.
app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
