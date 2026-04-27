// ============================================================
// SERVIDOR PRINCIPAL - AdaptIA Backend
// ============================================================
// Este arquivo é o ponto de entrada do servidor Node.js/Express.
// Ele gerencia todas as rotas, intermediário (middlewares) e a comunicação
// entre o front-end e os serviços de IA (OpenAI e Gemini).
// ============================================================

// ----------------------------------------------------------
// IMPORTAÇÃO DE MÓDULOS
// ----------------------------------------------------------

// Express: Framework web para criar o servidor HTTP
const express = require("express");

// CORS: Permite que o front-end (que roda em outra porta)
// faça requisições para este backend sem erros de segurança
const cors = require("cors");

// Multer: Middleware para processar uploads de arquivos
// (multipart/form-data). Salva arquivos temporariamente no servidor.
const multer = require("multer");

// Path: Utilitário do Node.js para manipular caminhos de arquivos
// e garantir compatibilidade entre sistemas operacionais
const path = require("path");

// FS (File System): Módulo nativo do Node.js para ler,
// escrever e manipular arquivos no sistema de arquivos
const fs = require("fs");

// Dotenv: Carrega variáveis de ambiente do arquivo .env
// para dentro de process.env (como OPENAI_API_KEY e GEMINI_API_KEY)
require("dotenv").config({ path: "./backend/.env" });

// ----------------------------------------------------------
// IMPORTAÇÃO DOS SERVIÇOS DE IA
// ----------------------------------------------------------

// Serviços que encapsulam a lógica de comunicação com as APIs
const { sendToOpenAI } = require("./services/openaiService");
const { sendToGemini } = require("./services/geminiService");

// Serviço para extrair conteúdo de arquivos
// (verifica se é imagem, PDF, texto, etc)
const { extractFileContent, isImageFile } = require("./services/fileService");

// Serviço que usa Gemini para fazer OCR em imagens
const { analyzeImageWithGemini } = require("./services/visionService");

// Serviço que usa Gemini para analisar documentos PDF completos
const { analyzePdfWithGemini } = require("./services/documentService");

// ----------------------------------------------------------
// CRIAÇÃO DA APLICAÇÃO EXPRESS
// ----------------------------------------------------------

const app = express();

// ----------------------------------------------------------
// CONFIGURAÇÃO DE MIDDLEWARES
// ----------------------------------------------------------

// Habilita CORS para todas as rotas
// Isso permite que front-ends de outras origens acessem este backend
app.use(cors());

// Parser JSON: Permite que o Express entenda requisições
// com corpo em formato JSON (application/json)
app.use(express.json());

// Serve arquivos estáticos: Torna públicos os arquivos da pasta front-end
// Isso significa que http://localhost:3000/index.html vai funcionar
app.use(express.static(path.join(__dirname, "..", "front-end")));

// ----------------------------------------------------------
// CONFIGURAÇÃO DO MULTER (UPLOAD DE ARQUIVOS)
// ----------------------------------------------------------

// Multer é configurado para salvar arquivos enviados pelo usuário
// no diretório "backend/uploads" temporariamente
const upload = multer({
  // Destino dos arquivos uploadados
  dest: path.join(__dirname, "uploads"),
  
  // Limite de tamanho: 15MB (evita arquivos muito grandes)
  limits: {
    fileSize: 15 * 1024 * 1024
  }
});

// ----------------------------------------------------------
// LOGS DE INICIALIZAÇÃO (DEBUG)
// ----------------------------------------------------------

// Verifica se as chaves de API foram carregadas corretamente
// Exibe "OK" ou "NÃO ENCONTRADA" no console ao iniciar
console.log("OPENAI:", process.env.OPENAI_API_KEY ? "OK" : "NÃO ENCONTRADA");
console.log("GEMINI:", process.env.GEMINI_API_KEY ? "OK" : "NÃO ENCONTRADA");

// ----------------------------------------------------------
// PROMPT DO SISTEMA
// ----------------------------------------------------------

// Define o comportamento padrão do assistente de IA
// Este texto é enviado junto com cada requisição para
// instruir a IA sobre como deve se comportar
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

// ----------------------------------------------------------
// ROTA DE HEALTH CHECK
// ----------------------------------------------------------
// Endpoint simples para verificar se o servidor está online
// Útil para sistemas de monitoramento ou para testar conexão

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "adapt-ia-backend"
  });
});

// ----------------------------------------------------------
// ROTA DE UPLOAD DE ARQUIVOS
// ----------------------------------------------------------
// Endpoint para receber arquivos do front-end
// Suporta: imagens, PDFs e arquivos de texto

app.post("/upload", upload.single("file"), async (req, res) => {
  try {
    // --------------------------------------------------------
    // DEBUG INICIAL - Registra dados recebidos
    // --------------------------------------------------------
    console.log("UPLOAD CHAMADO");
    console.log("Arquivo recebido:", req.file);
    console.log("Body recebido:", req.body);

    // --------------------------------------------------------
    // EXTRAÇÃO DE DADOS DO REQUEST
    // --------------------------------------------------------
    // provider: Qual IA usar (gemini ou openai)
    // message: Texto opcional digitado pelo usuário
    // history: Histórico da conversa (vem como string JSON)
    const { provider, message = "Analise este arquivo.", history = "[]" } = req.body;

    // --------------------------------------------------------
    // VALIDAÇÃO
    // --------------------------------------------------------
    // Verifica se um arquivo foi realmente enviado
    if (!req.file) {
      return res.status(400).json({
        reply: "Nenhum arquivo foi enviado."
      });
    }

    // --------------------------------------------------------
    // PROCESSAMENTO DO HISTÓRICO
    // --------------------------------------------------------
    // O histórico vem como string JSON → converte para Array
    const parsedHistory = JSON.parse(history);
    console.log("Histórico convertido OK");

    // --------------------------------------------------------
    // VARIÁVEL PARA RESPOSTA FINAL
    // --------------------------------------------------------
    let reply;

    // --------------------------------------------------------
    // PROCESSAMENTO BASEADO NO TIPO DE ARQUIVO
    // --------------------------------------------------------

    // CASO 1: ARQUIVO É UM PDF
    if (req.file.mimetype === "application/pdf") {
      console.log("PDF detectado → enviando para Gemini completo");
      // Usa serviço especializado que faz OCR completo no PDF
      reply = await analyzePdfWithGemini(req.file, message);
      console.log("PDF analisado OK");
    }
    // CASO 2: ARQUIVO É UMA IMAGEM
    else if (req.file.mimetype.startsWith("image/")) {
      console.log("Imagem detectada → OCR Gemini");
      // Usa serviço de visão para extrair texto e descrever imagem
      reply = await analyzeImageWithGemini(req.file, message);
      console.log("Imagem analisada OK");
    }
    // CASO 3: OUTROS ARQUIVOS (txt, csv, código, etc)
    else {
      console.log("Arquivo texto detectado");
      // Lê o conteúdo do arquivo como texto
      const fileContent = fs.readFileSync(req.file.path, "utf-8");

      // Monta mensagens para enviar à IA
      const messages = [
        ...parsedHistory, // mantém histórico anterior para contexto
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

      // Envia para o Gemini para análise
      reply = await sendToGemini(messages);
    }

    // --------------------------------------------------------
    // DEBUG FINAL - Confirma resposta antes de enviar
    // --------------------------------------------------------
    console.log("RESPOSTA FINAL QUE VAI PRO FRONT:", reply);

    // --------------------------------------------------------
    // RETORNO PARA O FRONT-END
    // --------------------------------------------------------
    // Retorna a resposta da IA e o nome do arquivo processado
    return res.status(200).json({
      reply, // resposta da IA
      fileName: req.file.originalname // nome original do arquivo
    });

  } catch (error) {
    // --------------------------------------------------------
    // TRATAMENTO DE ERROS
    // --------------------------------------------------------
    console.error("Erro no /upload:", error);
    return res.status(500).json({
      reply: "Erro ao processar arquivo.",
      error: error.message
    });
  }
});

// ----------------------------------------------------------
// ROTA PRINCIPAL DE CHAT
// ----------------------------------------------------------
// Endpoint para enviar mensagens de texto para a IA
// Sem upload de arquivos, apenas conversa

app.post("/chat", async (req, res) => {
  try {
    // Extrai dados enviados pelo front-end
    const { provider, message, history = [] } = req.body;

    // Log de debug para rastreamento
    console.log("Provider recebido:", provider);
    console.log("Message recebida:", message);
    console.log("History recebida:", history);

    // --------------------------------------------------------
    // VALIDAÇÃO BÁSICA
    // --------------------------------------------------------
    if (!provider || !message) {
      return res.status(400).json({
        reply: "Dados inválidos. provider e message são obrigatórios."
      });
    }

    // --------------------------------------------------------
    // MONTAGEM DAS MENSAGENS PARA A IA
    // --------------------------------------------------------
    // Cria prompt de sistema com regras de comportamento
    const systemPrompt = {
      role: "system",
      content: getSystemPrompt()
    };

    // Junta: prompt do sistema + histórico + mensagem atual
    const messages = [systemPrompt, ...history];

    console.log("Messages montadas:", messages);

    // --------------------------------------------------------
    // ENVIO PARA A IA ESCOLHIDA
    // --------------------------------------------------------
    let reply;

    if (provider === "openai") {
      // Tenta OpenAI primeiro
      try {
        reply = await sendToOpenAI(messages);
      } catch (error) {
        // Se OpenAI falhar, faz fallback para Gemini
        console.log("OpenAI falhou, usando Gemini...");
        console.error("Erro OpenAI:", error.message);
        reply = await sendToGemini(messages);
      }
    } else if (provider === "gemini") {
      // Usa Gemini diretamente
      reply = await sendToGemini(messages);
    } else {
      // Provedor inválido
      return res.status(400).json({
        reply: "Provedor desconhecido. Escolha 'openai' ou 'gemini'."
      });
    }

    // Retorna resposta para o front-end
    return res.json({ reply });

  } catch (error) {
    // --------------------------------------------------------
    // TRATAMENTO DE ERROS
    // --------------------------------------------------------
    console.error("Erro no /chat:", error);
    return res.status(500).json({
      reply:
        "O Gemini atingiu o limite gratuito no momento. Aguarde alguns segundos e tente novamente.",
      error: error.message
    });
  }
});

// ----------------------------------------------------------
// INICIALIZAÇÃO DO SERVIDOR
// ----------------------------------------------------------

// Porta que o servidor vai ouvir (padrão: 3000)
// Pode ser alterada via variável de ambiente PORT
const PORT = process.env.PORT || 3000;

// Inicia o servidor e exibe mensagem no console
app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});