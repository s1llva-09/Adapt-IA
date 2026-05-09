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

// Cache temporario dos graficos extraidos de planilhas.
// Quando o usuario envia um Excel/CSV, o backend cria um objeto chart
// com labels, values e metadados das colunas usadas.
// Esse objeto fica guardado pelo id da conversa para permitir pedidos futuros,
// por exemplo: depois de enviar a planilha, o usuario pode pedir
// "agora faz um grafico de pizza" sem precisar reenviar o arquivo.
const chartCacheByConversation = new Map();

// Fallback simples para o ultimo grafico gerado.
// Ajuda quando ainda nao ha conversationId disponivel ou em testes locais.
let lastWorkbookChart = null;

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
- Não peça permissão para começar uma análise se o usuário já enviou dados, arquivos ou uma pergunta clara.
- Quando houver ambiguidade, faça uma suposição razoável, informe a suposição e prossiga.
- Se uma coluna parecer representar comprador, cliente, valor, data, produto, quantidade ou categoria, use-a automaticamente.
- Só faça pergunta antes de responder se realmente for impossível continuar sem aquela informação.
- Sempre entregue uma análise completa primeiro; perguntas complementares devem ficar no final.
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
- Não peça permissão para começar a responder quando o usuário já pediu uma análise.
- Se houver arquivo enviado, analise diretamente o conteúdo.
- Quando houver ambiguidade, faça uma suposição razoável, avise qual foi a suposição e prossiga.
- Evite respostas do tipo “posso analisar?” ou “quer que eu comece?”. Comece a análise.
- Sempre entregue uma resposta completa e objetiva.
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

//Verifica se arquivos enviados sao Excel/CSV
// Usamos mimetype e extensão porque alguns navegadores podem mandar mimetype diferente.
function isExcelFile(file) {
  const fileName = file.originalname.toLowerCase();

  return (
    file.mimetype === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    file.mimetype === "application/vnd.ms-excel" ||
    file.mimetype === "text/csv" ||
    fileName.endsWith(".xlsx") ||
    fileName.endsWith(".xls") ||
    fileName.endsWith(".csv")
  );
}

// ==========================================================
// GERA DADOS DE GRÁFICO AUTOMATICAMENTE A PARTIR DO EXCEL
// ==========================================================

function generateChartFromWorkbook(workbook, userMessage = "") {
  try {
    // Pega a primeira aba do Excel
    const firstSheetName = workbook.SheetNames[0];

    // Se não existir aba, não gera gráfico
    if (!firstSheetName) return null;

    // Pega a planilha da primeira aba
    const sheet = workbook.Sheets[firstSheetName];

    // Converte a planilha para JSON
    // Cada linha vira um objeto JavaScript
    const rows = XLSX.utils.sheet_to_json(sheet);

    // Se não tiver linhas, não gera gráfico
    if (!rows || rows.length === 0) return null;

    // Pega as colunas da primeira linha
    const columns = Object.keys(rows[0]);

    // Se não tiver colunas, não gera gráfico
    if (columns.length === 0) return null;

    // Normaliza textos para comparar sem depender de maiusculas ou acentos.
    const normalizeText = (value) =>
      String(value || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");

    // ======================================================
    // IDENTIFICAR TIPO DO GRAFICO PEDIDO
    // ======================================================

    const normalizedMessage = normalizeText(userMessage);

    // Se o usuario pedir pizza/setores/porcentagem, o backend manda "pie".
    // Caso contrario, mantem "bar" como comportamento padrao.
    const chartType =
      normalizedMessage.includes("pizza") ||
      normalizedMessage.includes("setor") ||
      normalizedMessage.includes("setores") ||
      normalizedMessage.includes("percentual") ||
      normalizedMessage.includes("porcentagem")
        ? "pie"
        : "bar";

    // ======================================================
    // TENTA DESCOBRIR QUAL COLUNA É O NOME/LABEL
    // ======================================================

    const labelColumn =
      columns.find((col) => normalizeText(col).includes("cliente")) ||
      columns.find((col) => normalizeText(col).includes("comprador")) ||
      columns.find((col) => normalizeText(col).includes("fornecedor")) ||
      columns.find((col) => normalizeText(col).includes("produto")) ||
      columns.find((col) => normalizeText(col).includes("item")) ||
      columns.find((col) => normalizeText(col).includes("nome")) ||
      columns[0];

    // ======================================================
    // TENTA DESCOBRIR QUAL COLUNA É O VALOR
    // ======================================================

    const valueColumn =
      columns.find((col) => normalizeText(col).includes("total")) ||
      columns.find((col) => normalizeText(col).includes("valor")) ||
      columns.find((col) => normalizeText(col).includes("venda")) ||
      columns.find((col) => normalizeText(col).includes("compra")) ||
      columns.find((col) => normalizeText(col).includes("quantidade")) ||
      columns.find((col) => normalizeText(col).includes("qtd")) ||
      columns.find((col) => col.toLowerCase().includes("preço")) ||
      columns.find((col) => normalizeText(col).includes("preco"));

    // Se não encontrou coluna numérica, não gera gráfico
    if (!valueColumn) return null;

    const parseChartValue = (rawCellValue) => {
      if (typeof rawCellValue === "number") {
        return rawCellValue;
      }

      let normalized = String(rawCellValue || "0")
        .replace("R$", "")
        .replace(/\s/g, "")
        .replace(/[^\d,.-]/g, "");

      const dotCount = (normalized.match(/\./g) || []).length;
      const hasComma = normalized.includes(",");
      const hasDot = normalized.includes(".");

      if (hasComma && hasDot) {
        normalized = normalized.replace(/\./g, "").replace(",", ".");
      } else if (hasComma) {
        normalized = normalized.replace(",", ".");
      } else if (
        dotCount > 1 ||
        /^\d{1,3}(\.\d{3})+$/.test(normalized)
      ) {
        normalized = normalized.replace(/\./g, "");
      }

      return Number(normalized);
    };

    // ======================================================
    // AGRUPA OS VALORES POR NOME
    // ======================================================

    const grouped = {};

    rows.forEach((row) => {
      // Pega o texto da coluna usada como label
      const label = String(row[labelColumn] || "Sem nome").trim();

      // Converte para número
      const value = parseChartValue(row[valueColumn]);

      // Se não for número válido, ignora
      if (!Number.isFinite(value)) return;

      // Se ainda não existir esse label, cria com zero
      if (!grouped[label]) {
        grouped[label] = 0;
      }

      // Soma o valor
      grouped[label] += value;
    });

    // ======================================================
    // CRIA RANKING DO MAIOR PARA O MENOR
    // ======================================================

    let ranking = Object.entries(grouped)
      .map(([label, value]) => ({
        label,
        value
      }))
      .sort((a, b) => b.value - a.value);

    // Se não gerou ranking, não retorna gráfico
    if (ranking.length === 0) return null;

    // Para grafico de pizza, muitos itens ficam feios.
    // Entao pegamos os 6 maiores e juntamos o restante em "Outros".
    if (chartType === "pie" && ranking.length > 6) {
      const topItems = ranking.slice(0, 6);
      const others = ranking.slice(6);
      const otherTotal = others.reduce((sum, item) => sum + item.value, 0);

      if (otherTotal > 0) {
        topItems.push({
          label: "Outros",
          value: otherTotal
        });
      }

      ranking = topItems;
    } else {
      // Para barras, pega top 10.
      ranking = ranking.slice(0, 10);
    }

    // ======================================================
    // RETORNA O OBJETO DO GRÁFICO PARA O FRONT
    // ======================================================

    return {
      type: chartType,
      title:
        chartType === "pie"
          ? `Distribuição por ${labelColumn}`
          : `Top ${ranking.length} por ${valueColumn}`,
      labels: ranking.map((item) => item.label),
      values: ranking.map((item) => item.value),
      meta: {
        sheet: firstSheetName,
        labelColumn,
        valueColumn
      }
    };
  } catch (error) {
    console.error("Erro ao gerar gráfico automático:", error);
    return null;
  }
}

function normalizeChartText(value) {
  // Deixa o texto em um formato facil de comparar:
  // minusculo e sem acentos. Assim "gráfico", "grafico" e "GRAFICO"
  // sao tratados do mesmo jeito.
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function getRequestedChartType(userMessage = "") {
  const normalizedMessage = normalizeChartText(userMessage);

  // Palavras que indicam grafico de pizza/participacao percentual.
  // Essa regra vem antes da regra de barras porque a frase pode conter
  // "grafico de pizza"; se "grafico" fosse lido primeiro, viraria bar.
  if (
    normalizedMessage.includes("pizza") ||
    normalizedMessage.includes("setor") ||
    normalizedMessage.includes("setores") ||
    normalizedMessage.includes("percentual") ||
    normalizedMessage.includes("porcentagem")
  ) {
    return "pie";
  }

  // Palavras que indicam grafico "normal", de barras/colunas/ranking.
  // Inclui termos mais naturais que o usuario costuma usar, como
  // "grafico normal", "valores absolutos" ou "outro grafico".
  if (
    normalizedMessage.includes("barra") ||
    normalizedMessage.includes("barras") ||
    normalizedMessage.includes("coluna") ||
    normalizedMessage.includes("colunas") ||
    normalizedMessage.includes("normal") ||
    normalizedMessage.includes("absoluto") ||
    normalizedMessage.includes("absolutos") ||
    normalizedMessage.includes("grafico") ||
    normalizedMessage.includes("visualizacao") ||
    normalizedMessage.includes("comparativo") ||
    normalizedMessage.includes("comparar") ||
    normalizedMessage.includes("outro") ||
    normalizedMessage.includes("ranking") ||
    normalizedMessage.includes("top")
  ) {
    return "bar";
  }

  return null;
}

function rememberWorkbookChart(conversationId, chart) {
  if (!chart) return;

  // Guarda globalmente o ultimo grafico para fallback.
  lastWorkbookChart = chart;

  // Se a conversa tem id, guarda o grafico especificamente para ela.
  // Isso evita misturar dados entre conversas diferentes.
  if (conversationId) {
    chartCacheByConversation.set(conversationId, chart);
  }
}

function buildChartFromCachedData(baseChart, userMessage = "") {
  if (!baseChart) return null;

  // Verifica se a mensagem atual realmente pede algum grafico.
  // Se nao pedir, retorna null para nao mostrar grafico em toda resposta.
  const requestedType = getRequestedChartType(userMessage);

  // So gera grafico em mensagem normal quando o usuario pede explicitamente.
  if (!requestedType) return null;

  // Reconstrui o ranking usando labels/values ja salvos do Excel.
  // Assim a rota /chat consegue criar outro grafico sem reler o arquivo.
  let ranking = (baseChart.labels || [])
    .map((label, index) => ({
      label,
      value: Number((baseChart.values || [])[index] || 0)
    }))
    .filter((item) => Number.isFinite(item.value))
    .sort((a, b) => b.value - a.value);

  if (ranking.length === 0) return null;

  // Pizza com muitos pedacos fica ilegivel.
  // Mantemos os 6 maiores e somamos o resto em "Outros".
  if (requestedType === "pie" && ranking.length > 6) {
    const topItems = ranking.slice(0, 6);
    const others = ranking.slice(6);
    const otherTotal = others.reduce((sum, item) => sum + item.value, 0);

    if (otherTotal > 0) {
      topItems.push({
        label: "Outros",
        value: otherTotal
      });
    }

    ranking = topItems;
  } else {
    // Barras continuam com top 10 para caber melhor no chat.
    ranking = ranking.slice(0, 10);
  }

  // Este objeto e o contrato com o front-end.
  // O chat.js usa type/labels/values para montar o Chart.js.
  return {
    type: requestedType,
    title:
      requestedType === "pie"
        ? `Distribuição por ${baseChart.meta?.labelColumn || "categoria"}`
        : `Top ${ranking.length} por ${baseChart.meta?.valueColumn || "valor"}`,
    labels: ranking.map((item) => item.label),
    values: ranking.map((item) => item.value),
    meta: baseChart.meta || null
  };
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
      conversationId,
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
    let chart = null;

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
    
    //CASO 3: ARQUIVO É EXCEL/CSV
    else if (isExcelFile(req.file)) {
      console.log("Excel/CSV detectado -> lendo planilha");

      //Lê o arquivo excel salvo temporariamente pelo Multer
      //req.file.path é o caminho físico do arquivo dentro da pasta backend/uploads
      const workbook = XLSX.readFile(req.file.path);

      // Gera dados de gráfico automaticamente
      // A mensagem do usuario entra junto para decidir se o primeiro
      // grafico deve ser pizza ou barras.
      chart = generateChartFromWorkbook(workbook, message);

      // Guarda o grafico no cache da conversa.
      // Depois disso, o usuario pode pedir outro grafico no /chat
      // sem reenviar o mesmo Excel.
      rememberWorkbookChart(conversationId, chart);
      console.log("Grafico gerado a partir do Excel:", chart);

      //Essa variavel vai juntar o conteudo de todas as abas da planilha 
      let excelContent = "";

      //Um excel pode ter varias abas
      //sheetNames é a lista com o nome de todas elas
      workbook.SheetNames.forEach((sheetName) => {
        //Pega a aba atual pelo seu nome
        const sheet = workbook.Sheets[sheetName];

        //converte a aba para CSV
        //CSV é texto simples, bom para enviar para a IA
        const sheetText = XLSX.utils.sheet_to_csv(sheet);

        //junta o nome da aba + conteudo da aba
        excelContent += `
ABA: ${sheetName}

${sheetText}

-------------------------
        `
      });

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

Arquivo Excel/CSV enviado:
${req.file.originalname}

Conteúdo extraído da planilha:
${limitedExcelContent}

Observação:
Se houver dados numéricos e categorias, analise os maiores valores e explique o ranking.
Não escreva JSON, configuração de Chart.js ou bloco de código de gráfico na resposta.
Se o usuário pedir gráfico, apenas explique o que ele mostra; o sistema desenha o gráfico visual separadamente.
          `.trim()
        }
      ];

      //envia o conteudo extraido para o gemini analisar
      reply = await sendToGemini(messages);

      console.log("Arquivo Excel/CSV analisado");
    }
    // CASO 4: OUTROS ARQUIVOS (txt, código, etc)
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
      chart,
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
      conversationId,
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

    // Busca o grafico salvo para esta conversa.
    // Se nao existir, usa o ultimo grafico como fallback.
    const cachedChart = conversationId
      ? chartCacheByConversation.get(conversationId)
      : lastWorkbookChart;

    // Se a mensagem atual pedir grafico, recria o chart usando
    // os dados em cache. Se nao pedir, a funcao retorna null.
    const chart = buildChartFromCachedData(cachedChart || lastWorkbookChart, message);

    if (chart) {
      console.log("Grafico gerado a partir do cache da conversa:", chart);
    }

    // Retorna resposta para o front-end
    return res.json({ reply, chart });

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
