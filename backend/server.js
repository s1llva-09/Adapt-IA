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

// XLSX: biblioteca usada para ler arquivos Excel (.xlsx e .xls)
const XLSX = require("xlsx");

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
const { analyzePdfWithGemini } = require("./services/documentService.JS");

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
function getSystemPrompt(assistantType, memories = []) {
  // Transforma os registros da tabela memories em texto simples para o prompt.
  // Cada memoria tem content, assistant_type, user_id etc.; aqui usamos apenas content.
  const memoryText = Array.isArray(memories) && memories.length > 0
    ? memories.map((memory) => `- ${memory.content}`).join("\n")
    : "Nenhuma memória persistente registrada ainda.";

  // Se o front-end enviou financial_management, o backend troca o papel
  // da IA para um agente especializado em gestão financeira empresarial.
  if (assistantType === "financial_management") {
    return `
Você é um agente especialista em gestão financeira empresarial.

Memórias persistentes do usuário:
${memoryText}

Regras:
- Ajude com fluxo de caixa, contas a pagar, contas a receber, custos, precificação, relatórios e tomada de decisão.
- Organize respostas em passos práticos quando o usuário pedir orientação.
- Se faltarem dados financeiros, faça perguntas objetivas antes de concluir.
- Não invente números, impostos ou regras específicas sem base no conteúdo recebido.
- Quando houver risco contábil, fiscal ou jurídico, recomende validação com profissional responsável.
- Responda sempre no idioma do usuário.
- Seja claro, profissional e útil.
    `.trim();
  }

  // Prompt padrão usado quando nenhum agente específico foi escolhido.
  return `
Você é um assistente inteligente, adaptável e multimodal.

Memórias persistentes do usuário:
${memoryText}

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
// EXTRAÇÃO DE MEMÓRIA
// ----------------------------------------------------------
// A memória persistente é diferente do histórico da conversa.
// Ela guarda fatos estáveis sobre o usuário/empresa para conversas futuras.

function buildMemoryExtractionMessages({
  assistantType,
  userMessage,
  assistantReply,
  history = []
}) {
  const recentHistory = Array.isArray(history)
    ? history.slice(-6).map((msg) => `${msg.role}: ${msg.content}`).join("\n")
    : "";

  return [
    {
      role: "system",
      content: `
Você decide se uma interação deve gerar UMA memória persistente para um agente empresarial.

Salve memória apenas quando houver informação duradoura sobre o usuário, empresa, preferência, objetivo, rotina, números importantes ou contexto recorrente.
Não salve perguntas genéricas, comandos momentâneos, elogios, saudações ou respostas sem valor futuro.

Retorne somente JSON válido, sem markdown:
{"memory":"texto curto da memória"}
ou
{"memory":null}
      `.trim()
    },
    {
      role: "user",
      content: `
Agente: ${assistantType || "general"}

Histórico recente:
${recentHistory || "Sem histórico anterior."}

Mensagem do usuário:
${userMessage}

Resposta da IA:
${assistantReply}
      `.trim()
    }
  ];
}

function parseExtractedMemory(rawText) {
  const text = String(rawText || "")
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

  const jsonText = text.match(/\{[\s\S]*\}/)?.[0] || text;

  try {
    const parsed = JSON.parse(jsonText);
    const memory = typeof parsed.memory === "string" ? parsed.memory.trim() : null;

    if (!memory || memory.length < 12) return null;

    return memory;
  } catch (error) {
    console.error("Erro ao interpretar memória extraída:", error);
    return null;
  }
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
// ROTA DE EXTRAÇÃO DE MEMÓRIA
// ----------------------------------------------------------
// O front chama esta rota depois que a IA responde.
// Ela usa a própria IA para decidir se a interação gerou algum
// aprendizado persistente que deve ser salvo na tabela memories.

app.post("/memory/extract", async (req, res) => {
  try {
    const {
      provider,
      assistantType,
      userMessage,
      assistantReply,
      history = []
    } = req.body;

    if (!assistantType || !userMessage || !assistantReply) {
      return res.json({ memory: null });
    }

    const messages = buildMemoryExtractionMessages({
      assistantType,
      userMessage,
      assistantReply,
      history
    });

    let rawMemoryResponse;

    if (provider === "openai") {
      try {
        rawMemoryResponse = await sendToOpenAI(messages);
      } catch (error) {
        console.log("OpenAI falhou na memória, usando Gemini...");
        rawMemoryResponse = await sendToGemini(messages);
      }
    } else {
      rawMemoryResponse = await sendToGemini(messages);
    }

    const memory = parseExtractedMemory(rawMemoryResponse);

    return res.json({ memory });
  } catch (error) {
    console.error("Erro no /memory/extract:", error);

    return res.status(500).json({
      memory: null,
      error: error.message
    });
  }
});

//Verifica se arquivos enviados sao Excel
// Usamos mimetype e extensão porque alguns navegadores podem mandar mimetype diferente.
function isExcelFile(file) {
  const fileName = file.originalname.toLowerCase()

  return (
    file.mimetype === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    file.mimetype === "application/vnd.ms-excel" ||
    fileName.endsWith(".xlsx") ||
    fileName.endsWith(".xls")
  )
}

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
    const {
      provider,
      assistantType,
      message = "Analise este arquivo.",
      history = "[]",
      memories = "[]"
    } = req.body;

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

    // As memorias também chegam como JSON string no FormData.
    // Se vierem vazias ou inválidas, usa array vazio para não quebrar upload.
    let parsedMemories = [];

    try {
      parsedMemories = JSON.parse(memories);
    } catch (error) {
      console.error("Erro ao converter memorias:", error);
    }

    // Cria o prompt correto de acordo com o agente recebido.
    // Para imagens e PDFs, juntamos esse prompt ao pedido do usuário,
    // porque esses serviços recebem uma instrução em texto simples.
    const systemPromptText = getSystemPrompt(assistantType, parsedMemories);
    const messageWithContext = `
${systemPromptText}

Pedido do usuário:
${message}
    `.trim();

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
      reply = await analyzePdfWithGemini(req.file, messageWithContext);
      console.log("PDF analisado OK");
    }
    // CASO 2: ARQUIVO É UMA IMAGEM
    else if (req.file.mimetype.startsWith("image/")) {
      console.log("Imagem detectada → OCR Gemini");
      // Usa serviço de visão para extrair texto e descrever imagem
      reply = await analyzeImageWithGemini(req.file, messageWithContext);
      console.log("Imagem analisada OK");
    }
    
    //CASO 3: ARQUIVO É EXCEL
    else if (isExcelFile(req.file)) {
      console.log("Excel detectado -> lendo planilha")

      //Lê o arquivo excel salvo temporariamente pelo Multer
      //req.file.path é o caminho físico do arquivo dentro da pasta backend/uploads
      const workbook = XLSX.readFile(req.file.path)

      //Essa variavel vai juntar o conteudo de todas as abas da planilha 
      let excelContent = ""

      //Um excel pode ter varias abas
      //sheetNames é a lista com o nome de todas elas
      workbook.SheetNames.forEach((SheetName) => {
        //Pega a aba atual pelo seu nome
        const sheet = workbook.Sheets[SheetName]

        //converte a aba para CSV
        //CSV é texto simples, bom para enviar para a IA
        const sheetText = XLSX.utils.sheet_to_csv(sheet)


        //junta o nome da aba + conteudo da aba
        excelContent += `
          ABA: ${sheetName}

          ${sheetText}

          -------------------------
        `
      })

        // Evita mandar uma planilha gigante demais para a IA.
        // Se quiser aumentar depois, pode trocar 12000 por 20000.
        const limitedExcelContent = excelContent.slice(0, 12000);

        //Monta as mensagens para a IA
        const messages = [
    {
      role: "system",
      content: systemPromptText
    },
    ...parsedHistory,
    {
      role: "user",
      content: `

      Mensagem do usuário:
      ${message}

      Arquivo Excel enviado:
      ${req.file.originalname}

      Conteúdo extraído da planilha:
      ${limitedExcelContent}
            `.trim()
          }
        ];

        //envia o conteudo extraido para o gemini analisar
        reply: await sendToGemini(message)

        console.log("Arquivo excel analisado")
    }
    // CASO 4: OUTROS ARQUIVOS (txt, csv, código, etc)
    else {
      console.log("Arquivo texto detectado");
      // Lê o conteúdo do arquivo como texto
      const fileContent = fs.readFileSync(req.file.path, "utf-8");

      // Monta mensagens para enviar à IA
      const messages = [
        {
          role: "system",
          // Para arquivos de texto/código, o contexto do agente entra
          // como mensagem system, igual acontece na rota /chat.
          content: systemPromptText
        },
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
    // assistantType define qual agente deve responder.
    // Exemplo atual: financial_management.
    const {
      provider,
      assistantType,
      message,
      history = [],
      memories = []
    } = req.body;

    // Log de debug para rastreamento
    console.log("Provider recebido:", provider);
    console.log("Agente recebido:", assistantType);
    console.log("Message recebida:", message);
    console.log("History recebida:", history);
    console.log("Memorias recebidas:", memories);

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
      // Aqui é onde o agente realmente muda o comportamento da IA.
      // As memorias entram junto para manter aprendizado de conversas anteriores.
      content: getSystemPrompt(assistantType, memories)
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
