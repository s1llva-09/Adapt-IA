// Importa o Express para criar o servidor
const express = require("express");

// Importa o CORS para permitir chamadas do front-end
const cors = require("cors");

//Permite o servidor receber arquivos enviados pelo usuário
const multer = require("multer") //recebe arquivos

//Importa um módulo nativo do Node.js
//Ajuda a trabalhar com caminhos e arquivos
const path = require("path") //manipula eles
const fs = require("fs");

// Carrega as variáveis de ambiente do arquivo .env dentro de backend/
require("dotenv").config({ path: "./backend/.env" });

// Importa os serviços que falam com OpenAI e Gemini
const { sendToOpenAI } = require("./services/openaiService");
const { sendToGemini } = require("./services/geminiService");

//importa os serviços de analise de imagem tanto com o gemini quanto com a biblioteca instalada
const { extractFileContent, isImageFile } = require("./services/fileService")
const { analyzeImageWithGemini } = require("./services/visionService")

const { analyzePdfWithGemini } = require("./services/documentService");

// Cria a aplicação
const app = express();

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "front-end")));

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
Você é um assistente inteligente, adaptável e multimodal.

Regras:
- Entenda o contexto pela conversa.
- Se o usuário enviar arquivos, imagens ou PDFs, analise o conteúdo recebido.
- Se houver imagem, descreva e leia textos visíveis usando OCR.
- Se houver PDF, analise o conteúdo do documento.
- Se o usuário falar de programação, responda como especialista.
- Se mudar de assunto, adapte-se ao novo contexto.
- Responda sempre no idioma do usuário.
- Seja claro, natural e útil.
  `.trim();
}

// Rota responsável por receber arquivos (imagem, PDF, etc)
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "adapt-ia-backend"
  });
});

app.post("/upload", upload.single("file"), async (req, res) => {
  try {

    // ===============================
    // 🧪 DEBUG INICIAL
    // ===============================

    console.log("UPLOAD CHAMADO");

    // Mostra todos os dados do arquivo recebido
    console.log("Arquivo recebido:", req.file);

    // Mostra os dados enviados junto (mensagem, provider, histórico)
    console.log("Body recebido:", req.body);


    // ===============================
    // 📦 EXTRAINDO DADOS DO REQUEST
    // ===============================

    // provider → gemini ou openai
    // message → texto digitado pelo usuário
    // history → histórico da conversa (vem como string)
    const { provider, message = "Analise este arquivo.", history = "[]" } = req.body;


    // ===============================
    // 🚫 VALIDAÇÃO
    // ===============================

    // Se não enviou arquivo, retorna erro
    if (!req.file) {
      return res.status(400).json({
        reply: "Nenhum arquivo foi enviado."
      });
    }


    // ===============================
    // 🔄 CONVERTENDO HISTÓRICO
    // ===============================

    // O histórico vem como string → transforma em array
    const parsedHistory = JSON.parse(history);

    console.log("Histórico convertido OK");


    // ===============================
    // 📩 VARIÁVEL DA RESPOSTA FINAL
    // ===============================

    let reply;


    // ===============================
    // 📄 CASO 1 → PDF
    // ===============================

    if (req.file.mimetype === "application/pdf") {

      console.log("PDF detectado → enviando para Gemini completo");

      // Chama função que envia PDF para o Gemini
      reply = await analyzePdfWithGemini(req.file, message);

      console.log("PDF analisado OK");
    }


    // ===============================
    // 🖼️ CASO 2 → IMAGEM
    // ===============================

    else if (req.file.mimetype.startsWith("image/")) {

      console.log("Imagem detectada → OCR Gemini");

      // Chama função que envia imagem para o Gemini
      reply = await analyzeImageWithGemini(req.file, message);

      console.log("Imagem analisada OK");
    }


    // ===============================
    // 📃 CASO 3 → OUTROS ARQUIVOS TEXTO
    // ===============================

    else {

      console.log("Arquivo texto detectado");

      // Lê o conteúdo do arquivo (txt, csv, etc)
      const fileContent = fs.readFileSync(req.file.path, "utf-8");

      // Monta mensagens para enviar para IA
      const messages = [
        ...parsedHistory, // mantém histórico anterior

        {
          role: "user",
          content: `
Mensagem:
${message}

Arquivo:
${fileContent}
          `.trim()
        }
      ];

      // Envia para o Gemini
      reply = await sendToGemini(messages);
    }


    // ===============================
    // 🔥 DEBUG FINAL (MUITO IMPORTANTE)
    // ===============================

    // Aqui você confirma se realmente tem resposta
    console.log("RESPOSTA FINAL QUE VAI PRO FRONT:", reply);


    // ===============================
    // 📤 RETORNO PARA O FRONT-END
    // ===============================

    // Isso aqui é o MAIS IMPORTANTE do sistema inteiro
    return res.status(200).json({
      reply, // resposta da IA
      fileName: req.file.originalname // nome do arquivo
    });


  } catch (error) {

    // ===============================
    // ❌ TRATAMENTO DE ERRO
    // ===============================

    console.error("Erro no /upload:", error);

    return res.status(500).json({
      reply: "Erro ao processar arquivo.",
      error: error.message
    });
  }
});

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
      reply:
        "O Gemini atingiu o limite gratuito no momento. Aguarde alguns segundos e tente novamente.",
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
