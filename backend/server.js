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
const { sendToGemini, sendToGeminiStream } = require("./services/geminiService");

// ----------------------------------------------------------
// SUPABASE ADMIN
// ----------------------------------------------------------
// Usa a service_role key (não a anon key) para operações privilegiadas:
// criar usuários, listar todos os usuários, verificar roles, deletar contas.
// Adicione no .env: SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY
const { createClient } = require("@supabase/supabase-js");

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Middleware: bloqueia a rota se o usuário não tiver role 'admin' na tabela profiles.
// Lê o JWT do header Authorization, verifica com o Supabase e consulta o perfil.
async function requireAdmin(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Token ausente." });

  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: "Token inválido." });

  const { data: profile } = await supabaseAdmin
    .from("profiles").select("role").eq("id", user.id).single();

  if (!profile || profile.role !== "admin")
    return res.status(403).json({ error: "Acesso negado. Apenas administradores." });

  req.user = user;
  next();
}

// Serviço que usa Gemini para fazer OCR em imagens
const { analyzeImageWithGemini } = require("./services/visionService");

// Serviço que usa Gemini para analisar documentos PDF completos
const { analyzePdfWithGemini } = require("./services/documentService");

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
  const memoryText = Array.isArray(memories) && memories.length > 0
    ? memories.map((memory) => `- ${memory.content}`).join("\n")
    : "Nenhuma memória persistente registrada ainda.";

  // Prompt customizado pelo admin tem prioridade
  const customPrompts = readCustomPrompts();
  if (customPrompts[assistantType]) {
    return customPrompts[assistantType].replace("{{memories}}", memoryText);
  }

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
- Quando o usuário pedir gráfico, não desenhe gráficos com texto, caracteres ASCII, blocos de código ou JSON.
- Se houver dados suficientes para gráfico, explique a visualização em texto; o sistema exibirá o gráfico visual separadamente.
- Responda sempre no idioma do usuário.
- Seja claro, profissional e útil.
    `.trim();
  }

  if (assistantType === "human_resources") {
    return `
Você é um agente especialista em Recursos Humanos.

Memórias persistentes do usuário:
${memoryText}

Regras:
- Ajude com recrutamento, seleção, clima organizacional, avaliação de desempenho, planos de carreira, treinamento e cultura.
- Forneça modelos de documentos, roteiros de entrevista, análises de perfil e estratégias de retenção.
- Quando houver dúvidas trabalhistas ou legais, recomende consulta com profissional habilitado.
- Seja empático, profissional e prático.
- Responda sempre no idioma do usuário.
    `.trim();
  }

  if (assistantType === "customer_service") {
    return `
Você é um agente especialista em Atendimento ao Cliente.

Memórias persistentes do usuário:
${memoryText}

Regras:
- Ajude com scripts de atendimento, respostas padronizadas, tratamento de reclamações, pós-venda e métricas de satisfação (NPS, CSAT).
- Sugira melhorias na experiência do cliente e estratégias de fidelização.
- Crie modelos de respostas para e-mail, chat e redes sociais quando solicitado.
- Seja claro, cordial e objetivo.
- Responda sempre no idioma do usuário.
    `.trim();
  }

  if (assistantType === "marketing_digital") {
    return `
Você é um agente especialista em Marketing Digital.

Memórias persistentes do usuário:
${memoryText}

Regras:
- Ajude com estratégias de conteúdo, SEO, Google Ads, redes sociais, e-mail marketing, funil de vendas e análise de métricas.
- Crie copies, títulos, legendas e sugestões de pauta quando solicitado.
- Analise dados de performance e sugira melhorias baseadas em dados.
- Seja criativo, estratégico e orientado a resultados.
- Responda sempre no idioma do usuário.
    `.trim();
  }

  if (assistantType === "legal") {
    return `
Você é um agente de orientação jurídica empresarial.

Memórias persistentes do usuário:
${memoryText}

Regras:
- Ajude com análise de contratos, cláusulas, termos e condições, compliance, LGPD, regulamentações setoriais e questões societárias.
- Identifique riscos e pontos de atenção em documentos jurídicos.
- SEMPRE recomende validação com advogado para decisões legais efetivas — você oferece orientação, não consultoria jurídica formal.
- Seja preciso, claro e não invente leis ou artigos.
- Responda sempre no idioma do usuário.
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
- Quando o usuário pedir gráfico, não desenhe gráficos com texto, caracteres ASCII, blocos de código ou JSON.
- Se houver dados suficientes para gráfico, explique a visualização em texto; o sistema exibirá o gráfico visual separadamente.
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

// ==========================================================
// COMPRIME/RESUME UMA CONVERSA GRANDE
// ==========================================================

async function summarizeConversation(messages) {
  //messages - lista de mensagens antigas na conversa
  // Exemplo:
  // [
  //   { role: "user", content: "Analise esse Excel" },
  //   { role: "assistant", content: "Aqui está a análise..." }
  // ]

    // Aqui transformamos o array de mensagens em um texto único.
  // Isso facilita enviar o conteúdo para a IA resumir.

  const textToSummarize = messages
    .map((msg) => {
      //se a mensagem for do usuario
      if (msg.role == "user") {
        return `Usuário: ${msg.content}`
      }

     //Se a mensagem veio da IA
     if (msg.role === "assistant") {
      return `IA: ${msg.content}`
     }

     //se for uma mensagem de sistema ou qualquer outro tipo
     return `Sistema: ${msg.content}`
    })
    .join("\n\n")

  // Montamos um prompt específico para a IA resumir contexto.
  // Esse prompt NÃO é para responder ao usuário final.
  // Ele é apenas para gerar uma memória curta da conversa.

  const summaryPrompt = [
    {
        role: "system",
      content: `
      Você é responsável por resumir conversas longas para economizar contexto.

      Crie um resumo curto, objetivo e útil para continuidade da conversa.

      Regras:
      - Preserve decisões importantes.
      - Preserve preferências do usuário.
      - Preserve nomes de arquivos analisados.
      - Preserve tecnologias, erros e soluções encontradas.
      - Preserve objetivos atuais do projeto.
      - Preserve informações sobre PDFs, imagens, Excel, gráficos e agentes usados.
      - Não inclua detalhes inúteis.
      - Não invente informações.
      - Escreva em português.
      `.trim()
    },
    {
        role: "user",
      content: `
      Resuma a conversa abaixo para ser usada como memória/contexto futuro:

      ${textToSummarize}
      `.trim()
    }
  ]

  // Envia o pedido de resumo para o Gemini.
  // Aqui reaproveitamos sua função sendToGemini().
  const summary = await sendToGemini(summaryPrompt);

  // Retorna o resumo gerado.
  return summary;
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

function parseBrazilianNumber(value) {
  // Converte valores escritos no padrão brasileiro para Number.
  // Exemplo: "R$ 1.600,00" vira 1600.
  const normalizedValue = String(value || "")
    .replace("R$", "")
    .replace(/\s/g, "")
    .replace(/\./g, "")
    .replace(",", ".");

  const number = Number(normalizedValue);

  return Number.isFinite(number) ? number : null;
}

function cleanChartLabel(label) {
  // Remove markdown, bullets e pontuação que costumam aparecer antes
  // do nome da categoria. Exemplo: "* **Contas:**" vira "Contas".
  return String(label || "")
    .replace(/\*\*/g, "")
    .replace(/^[\s>*•\-–—]+/g, "")
    .replace(/[\s:=-]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isIgnoredChartLabel(label) {
  // Linhas como "Total" ou "Orçamento mensal" são soma geral,
  // não categorias. Elas precisam ficar fora do gráfico para não
  // duplicar os valores.
  const normalizedLabel = normalizeChartText(label);

  return (
    !normalizedLabel ||
    normalizedLabel === "total" ||
    normalizedLabel.includes("total geral") ||
    normalizedLabel.includes("subtotal") ||
    normalizedLabel.includes("soma") ||
    normalizedLabel.includes("orcamento mensal") ||
    normalizedLabel.includes("seu orcamento") ||
    normalizedLabel.includes("valor total") ||
    normalizedLabel.includes("receita total") ||
    normalizedLabel.includes("grafico")
  );
}

function extractChartPairsFromText(text) {
  // Procura pares "categoria + valor" em textos comuns de conversa.
  // Exemplos aceitos:
  // "Contas: R$ 800,00"
  // "Estudos (R$ 500,00)"
  // "Lazer R$ 300"
  const chunks = String(text || "")
    .replace(/\*\*/g, "")
    .split(/\n|;|,(?=\s*[A-Za-zÀ-ÿ])/g);

  const pairs = [];

  chunks.forEach((chunk) => {
    const textChunk = chunk.trim();
    if (!textChunk) return;

    const patterns = [
      /^[\s>*•\-–—]*([A-Za-zÀ-ÿ0-9][A-Za-zÀ-ÿ0-9 _./-]{1,60}?)\s*[:=]\s*(?:R\$\s*)?([\d.]+(?:,\d{1,2})?|\d+(?:\.\d{1,2})?)\b/i,
      /^[\s>*•\-–—]*([A-Za-zÀ-ÿ0-9][A-Za-zÀ-ÿ0-9 _./-]{1,60}?)\s*\(?\s*R\$\s*([\d.]+(?:,\d{1,2})?)\s*\)?/i
    ];

    for (const pattern of patterns) {
      const match = textChunk.match(pattern);
      if (!match) continue;

      const label = cleanChartLabel(match[1]);
      const value = parseBrazilianNumber(match[2]);

      if (value === null || isIgnoredChartLabel(label)) return;

      pairs.push({ label, value });
      return;
    }
  });

  return pairs;
}

function buildChartFromConversationValues(history = [], userMessage = "") {
  // Se não existe gráfico de planilha em cache, esta função tenta
  // montar um gráfico usando valores que já apareceram no chat.
  // Isso resolve pedidos sem arquivo, como:
  // "Contas R$ 800, Estudos R$ 500 e Lazer R$ 300. Faça pizza."
  const requestedType = getRequestedChartType(userMessage);

  if (!requestedType) return null;

  const messagesToSearch = [
    ...history,
    {
      role: "user",
      content: userMessage
    }
  ];

  // Busca de trás para frente para usar os dados mais recentes.
  // Assim não somamos valores antigos repetidos pela própria IA.
  for (let index = messagesToSearch.length - 1; index >= 0; index -= 1) {
    const content = messagesToSearch[index]?.content;
    const pairs = extractChartPairsFromText(content);

    if (pairs.length < 2) continue;

    const grouped = new Map();

    pairs.forEach((item) => {
      const key = normalizeChartText(item.label);
      const current = grouped.get(key) || {
        label: item.label,
        value: 0
      };

      current.value += item.value;
      grouped.set(key, current);
    });

    let ranking = Array.from(grouped.values())
      .filter((item) => Number.isFinite(item.value))
      .sort((a, b) => b.value - a.value);

    if (ranking.length < 2) continue;

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
      ranking = ranking.slice(0, 10);
    }

    // Mesmo formato usado pelo gráfico vindo do Excel.
    // O front-end não precisa saber se a origem foi planilha ou conversa.
    return {
      type: requestedType,
      title:
        requestedType === "pie"
          ? "Distribuição por categoria"
          : "Comparativo por valor",
      labels: ranking.map((item) => item.label),
      values: ranking.map((item) => item.value),
      meta: {
        source: "conversation"
      }
    };
  }

  return null;
}

// ----------------------------------------------------------
// ROTA DE UPLOAD DE ARQUIVOS
// ----------------------------------------------------------
// Endpoint para receber arquivos do front-end
// Suporta: imagens, PDFs e arquivos de texto

app.post("/upload", upload.array("files", 4), async (req, res) => {
  try {
    console.log("UPLOAD CHAMADO");
    console.log("Arquivos recebidos:", (req.files || []).map(f => f.originalname));

    const {
      provider,
      assistantType,
      conversationId,
      message = "Analise este arquivo.",
      history = "[]",
      memories = "[]"
    } = req.body;

    const files = req.files || [];

    if (files.length === 0) {
      return res.status(400).json({ reply: "Nenhum arquivo foi enviado." });
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

    const systemPromptText = getSystemPrompt(assistantType, parsedMemories);
    const messageWithContext = `${systemPromptText}\n\nPedido do usuário:\n${message}`.trim();

    let reply;
    let chart = null;

    // -------------------------------------------------------
    // ARQUIVO ÚNICO — comportamento original preservado
    // -------------------------------------------------------
    if (files.length === 1) {
      const file = files[0];

      if (file.mimetype === "application/pdf") {
        reply = await analyzePdfWithGemini(file, messageWithContext);
      } else if (file.mimetype.startsWith("image/")) {
        reply = await analyzeImageWithGemini(file, messageWithContext);
      } else if (isExcelFile(file)) {
        const workbook = XLSX.readFile(file.path);
        chart = generateChartFromWorkbook(workbook, message);
        rememberWorkbookChart(conversationId, chart);

        let excelContent = "";
        workbook.SheetNames.forEach((sheetName) => {
          const sheet = workbook.Sheets[sheetName];
          excelContent += `ABA: ${sheetName}\n${XLSX.utils.sheet_to_csv(sheet)}\n---\n`;
        });

        reply = await sendToGemini([
          { role: "system", content: systemPromptText },
          ...parsedHistory,
          { role: "user", content: `${message}\n\nArquivo: ${file.originalname}\n\n${excelContent.slice(0, 12000)}\n\nObs: não escreva JSON ou código de gráfico na resposta.`.trim() }
        ]);
      } else {
        const fileContent = fs.readFileSync(file.path, "utf-8");
        reply = await sendToGemini([
          { role: "system", content: systemPromptText },
          ...parsedHistory,
          { role: "user", content: `${message}\n\nArquivo (${file.originalname}):\n${fileContent}`.trim() }
        ]);
      }

      fs.unlink(file.path, () => {});

    // -------------------------------------------------------
    // MÚLTIPLOS ARQUIVOS — extrai todos, sintetiza em 1 chamada
    // -------------------------------------------------------
    } else {
      const extractions = [];

      for (const file of files) {
        try {
          if (file.mimetype === "application/pdf") {
            const text = await analyzePdfWithGemini(file, "Extraia o conteúdo completo deste documento.");
            extractions.push({ name: file.originalname, content: text });
          } else if (file.mimetype.startsWith("image/")) {
            const text = await analyzeImageWithGemini(file, "Descreva e extraia todo o texto visível nesta imagem.");
            extractions.push({ name: file.originalname, content: text });
          } else if (isExcelFile(file)) {
            const workbook = XLSX.readFile(file.path);
            if (!chart) {
              chart = generateChartFromWorkbook(workbook, message);
              rememberWorkbookChart(conversationId, chart);
            }
            let excelContent = "";
            workbook.SheetNames.forEach((sheetName) => {
              const sheet = workbook.Sheets[sheetName];
              excelContent += `Aba: ${sheetName}\n${XLSX.utils.sheet_to_csv(sheet)}\n---\n`;
            });
            extractions.push({ name: file.originalname, content: excelContent.slice(0, 10000) });
          } else {
            const text = fs.readFileSync(file.path, "utf-8");
            extractions.push({ name: file.originalname, content: text });
          }
        } catch (fileErr) {
          console.error(`Erro ao processar ${file.originalname}:`, fileErr.message);
          extractions.push({ name: file.originalname, content: "(erro ao processar este arquivo)" });
        } finally {
          fs.unlink(file.path, () => {});
        }
      }

      const combinedContent = extractions
        .map(e => `=== ${e.name} ===\n${e.content}`)
        .join("\n\n");

      reply = await sendToGemini([
        { role: "system", content: systemPromptText },
        ...parsedHistory,
        { role: "user", content: `${message}\n\nArquivos enviados (${files.length}):\n\n${combinedContent}`.trim() }
      ]);
    }

    return res.status(200).json({
      reply,
      chart,
      fileNames: files.map(f => f.originalname)
    });

  } catch (error) {
    (req.files || []).forEach(f => fs.unlink(f.path, () => {}));
    console.error("Erro no /upload:", error);
    return res.status(500).json({ reply: "Erro ao processar arquivo.", error: error.message });
  }
});

// ==========================================================
// ROTA PARA COMPRIMIR CONTEXTO DA CONVERSA
// ==========================================================

app.post("/memory/compress", async (req, res) => {
  try {
    // Recebe do front as mensagens antigas que precisam ser resumidas.
    // Se não vier nada, usa um array vazio.
    const { messages = [] } = req.body

    // Validação básica:
    // precisa ser um array e precisa ter pelo menos uma mensagem.
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({
        error: "Nenhuma mensagem enviada para compressão."
      })
    }

    // Logs para você acompanhar no terminal.
    console.log("Comprimindo contexto...")
    console.log("Quantidade de mensagens:", messages.length)

    // Chama a função que pede para a IA resumir as mensagens.
    const summary = await summarizeConversation(messages)

    // Mostra o resumo gerado no terminal.
    console.log("Resumo gerado:", summary)

    // Retorna o resumo para o front-end.
    return res.json({
      summary
    });

  } catch (error) {
    // Se der erro, mostra no terminal.
    console.error("Erro ao comprimir contexto:", error)

    // Retorna erro para o front.
    return res.status(500).json({
      error: error.message || "Erro ao comprimir contexto."
    })
  }
})

// Gera um título curto para uma conversa com base na primeira troca de mensagens.
app.post("/generate-title", async (req, res) => {
  try {
    const { message = "", reply = "" } = req.body;
    const prompt = `Crie um título curto (máximo 6 palavras) para uma conversa que começou assim:\n\nUsuário: ${message}\nIA: ${reply.slice(0, 300)}\n\nResponda APENAS com o título, sem aspas, sem pontuação final e sem explicação.`;
    const title = await sendToGemini([{ role: "user", content: prompt }]);
    return res.json({ title: (title || "Nova conversa").slice(0, 60) });
  } catch (error) {
    return res.json({ title: "Nova conversa" });
  }
});

// Gera um resumo executivo da conversa em bullet points.
app.post("/summarize", async (req, res) => {
  try {
    const { history = [] } = req.body;
    if (history.length < 2) return res.json({ summary: "Não há mensagens suficientes para resumir." });
    const transcript = history
      .filter(m => m.content)
      .map(m => `${m.role === "user" ? "Usuário" : "IA"}: ${m.content}`)
      .join("\n\n");
    const prompt = `Crie um Resumo Executivo desta conversa em até 5 bullet points.\nSeja direto, foque em decisões, dados e informações relevantes para o negócio.\nFormato: cada ponto começa com "• ".\n\nConversa:\n${transcript}`;
    const summary = await sendToGemini([{ role: "user", content: prompt }]);
    return res.json({ summary: summary || "Não foi possível gerar o resumo." });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Erro ao gerar resumo." });
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

    // Se a mensagem atual pedir grafico, primeiro tenta usar dados salvos
    // de planilha. Se não houver planilha em cache, tenta extrair pares
    // categoria/valor do próprio histórico da conversa.
    // Memorias persistentes tambem podem conter valores úteis.
    // Exemplo: o usuário limpou a conversa, mas a memória ainda guarda
    // "Contas R$ 800, Estudos R$ 500 e Lazer R$ 300".
    // Por isso elas entram como fonte secundária para montar gráficos.
    const memoryHistoryForChart = Array.isArray(memories)
      ? memories.map((memory) => ({
          role: "system",
          content: memory.content || ""
        }))
      : [];

    const chart =
      buildChartFromCachedData(cachedChart || lastWorkbookChart, message) ||
      buildChartFromConversationValues(
        [...history, ...memoryHistoryForChart],
        message
      );

    if (chart) {
      console.log("Grafico gerado para a conversa:", chart);
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

// Versão com streaming da rota /chat.
// Usa SSE (Server-Sent Events) para enviar o texto conforme é gerado.
// O front-end lê os chunks e exibe progressivamente, igual ao ChatGPT.
app.post("/chat-stream", async (req, res) => {
  const {
    provider,
    assistantType,
    conversationId,
    message,
    history = [],
    memories = []
  } = req.body

  if (!provider || !message) {
    return res.status(400).json({
      error: "provider e message são obrigatórios"
    })
  }

  // Cabeçalhos SSE: mantém a conexão aberta e envia eventos de texto
  res.setHeader("Content-Type", "text/event-stream")
  res.setHeader("Cache-Control", "no-cache")
  res.setHeader("Connection", "keep-alive")
  res.flushHeaders()

  const systemPrompt = {
    role: "system",
    content: getSystemPrompt(assistantType, memories)
  }
  const msgs = [systemPrompt, ...history]

  let fullReply = ""

  try {
    if (provider === "gemini") {
      // Streaming real: envia cada chunk assim que o Gemini gerar
      fullReply = await sendToGeminiStream(msgs, (chunk) => {
        res.write(`data: ${JSON.stringify({ chunk })}\n\n`)
      })
    } else if (provider === "openai") {
      // OpenAI sem streaming por enquanto: manda a resposta completa de uma vez
      fullReply = await sendToOpenAI(msgs)
      res.write(`data: ${JSON.stringify({ chunk: fullReply })}\n\n`)
    }else {
      res.write(`data: ${JSON.stringify({ error: "Provedor inválido." })}\n\n`)
      return res.end()
    }

    // Lógica de gráfico (igual à rota /chat)
    const cachedChart = conversationId
      ? chartCacheByConversation.get(conversationId)
      : lastWorkbookChart

      const memoryHistoryForChart = Array.isArray(memories)
      ? memories.map((m) => ({ role: "system", content: m.content || "" }))
      : []

      const chart =
      buildChartFromCachedData(cachedChart || lastWorkbookChart, message) ||
      buildChartFromConversationValues([...history, ...memoryHistoryForChart], message)

      // Evento final: sinaliza que acabou e envia o gráfico se houver
      res.write(`data: ${JSON.stringify({ done: true, chart: chart || null })}\n\n`);
      res.end()
      
  } catch (error) {
    console.error("Erro no /chat/stream:", error);
    res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
    res.end();
  }
})

// ----------------------------------------------------------
// ROTA: Perfil do usuário atual
// ----------------------------------------------------------
// Retorna o role e os agentes permitidos do usuário logado.
// O front-end usa isso para mostrar/esconder o menu Admin.

app.get("/profile", async (req, res) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Token ausente." });

  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: "Token inválido." });

  const { data: profile } = await supabaseAdmin
    .from("profiles").select("*").eq("id", user.id).single();

  res.json({ profile: profile || { id: user.id, role: "user", allowed_agents: [] } });
});

// ----------------------------------------------------------
// ROTA: Listar todos os usuários (admin)
// ----------------------------------------------------------

app.get("/admin/users", requireAdmin, async (req, res) => {
  const { data: { users }, error } = await supabaseAdmin.auth.admin.listUsers();
  if (error) return res.status(500).json({ error: error.message });

  const { data: profiles } = await supabaseAdmin.from("profiles").select("*");
  const profileMap = {};
  (profiles || []).forEach((p) => (profileMap[p.id] = p));

  const result = users.map((u) => ({
    id: u.id,
    email: u.email,
    created_at: u.created_at,
    role: profileMap[u.id]?.role || "user",
    allowed_agents: profileMap[u.id]?.allowed_agents || []
  }));

  res.json({ users: result });
});

// ----------------------------------------------------------
// ROTA: Criar usuário (admin)
// ----------------------------------------------------------

app.post("/admin/users", requireAdmin, async (req, res) => {
  const { email, password, role = "user", allowed_agents = [] } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: "Email e senha são obrigatórios." });

  const { data: { user }, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true
  });

  if (error) return res.status(400).json({ error: error.message });

  await supabaseAdmin.from("profiles").upsert({ id: user.id, role, allowed_agents });

  res.json({ user: { id: user.id, email: user.email, role, allowed_agents } });
});

// ----------------------------------------------------------
// ROTA: Atualizar perfil de usuário (admin)
// ----------------------------------------------------------

app.put("/admin/users/:userId", requireAdmin, async (req, res) => {
  const { userId } = req.params;
  const { role, allowed_agents } = req.body;

  const updates = {};
  if (role !== undefined) updates.role = role;
  if (allowed_agents !== undefined) updates.allowed_agents = allowed_agents;

  const { error } = await supabaseAdmin
    .from("profiles").update(updates).eq("id", userId);

  if (error) return res.status(400).json({ error: error.message });

  res.json({ success: true });
});

// ----------------------------------------------------------
// ROTA: Deletar usuário (admin)
// ----------------------------------------------------------

app.delete("/admin/users/:userId", requireAdmin, async (req, res) => {
  const { userId } = req.params;

  const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
  if (error) return res.status(400).json({ error: error.message });

  res.json({ success: true });
});

// ----------------------------------------------------------
// ROTA: Analytics (admin)
// ----------------------------------------------------------

app.get("/admin/stats", requireAdmin, async (req, res) => {
  try {
    const [
      { count: totalUsers },
      { count: totalConversations },
      { count: totalMessages },
      { data: agentRows },
      { data: dailyRows }
    ] = await Promise.all([
      supabaseAdmin.from("profiles").select("*", { count: "exact", head: true }),
      supabaseAdmin.from("conversations").select("*", { count: "exact", head: true }),
      supabaseAdmin.from("messages").select("*", { count: "exact", head: true }),
      supabaseAdmin.from("conversations").select("assistant_type"),
      supabaseAdmin.from("messages")
        .select("created_at")
        .gte("created_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
    ]);

    // Contagem por agente
    const agentCount = {};
    (agentRows || []).forEach(r => {
      const k = r.assistant_type || "general";
      agentCount[k] = (agentCount[k] || 0) + 1;
    });

    // Mensagens por dia (últimos 7 dias)
    const dayCount = {};
    (dailyRows || []).forEach(r => {
      const day = r.created_at?.slice(0, 10);
      if (day) dayCount[day] = (dayCount[day] || 0) + 1;
    });
    const last7 = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(Date.now() - (6 - i) * 24 * 60 * 60 * 1000);
      const key = d.toISOString().slice(0, 10);
      return { date: key, count: dayCount[key] || 0 };
    });

    return res.json({ totalUsers, totalConversations, totalMessages, agentCount, dailyMessages: last7 });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// ----------------------------------------------------------
// ROTA: Editor de system prompts (admin)
// Armazena prompts customizados em backend/prompts.json
// ----------------------------------------------------------

const PROMPTS_FILE = path.join(__dirname, "prompts.json");

function readCustomPrompts() {
  try {
    if (fs.existsSync(PROMPTS_FILE)) return JSON.parse(fs.readFileSync(PROMPTS_FILE, "utf-8"));
  } catch { /* ignore */ }
  return {};
}

function writeCustomPrompts(data) {
  fs.writeFileSync(PROMPTS_FILE, JSON.stringify(data, null, 2), "utf-8");
}

app.get("/admin/prompts", requireAdmin, (req, res) => {
  res.json({ prompts: readCustomPrompts() });
});

app.put("/admin/prompts/:agentType", requireAdmin, (req, res) => {
  const { agentType } = req.params;
  const { prompt } = req.body;
  if (typeof prompt !== "string") return res.status(400).json({ error: "Campo 'prompt' obrigatório." });

  const data = readCustomPrompts();
  if (prompt.trim()) data[agentType] = prompt.trim();
  else delete data[agentType]; // string vazia = restaurar padrão
  writeCustomPrompts(data);
  res.json({ success: true });
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
})
