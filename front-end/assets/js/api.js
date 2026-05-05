// ============================================================
// MÓDULO DE COMUNICAÇÃO COM BACKEND - AdaptIA Front-end
// ============================================================
// Este arquivo centraliza toda a comunicação entre o front-end
// e o servidor backend. Ele tenta se conectar a múltiplas URLs
// em caso de falha e padroniza o formato das requisições.
// ============================================================

// Log indicating this module is loaded
console.log("API.JS NOVO CARREGADO");

// ============================================================
// FUNÇÃO: OBTER CANDIDATOS DE URL DO BACKEND
// ============================================================
// Esta função verifica múltiplas possibilidades de URL para
// encontrar o backend. Isso é útil porque:
// - O backend pode estar em localhost:3000
// - Pode estar em 127.0.0.1:3000
// - Pode estar em outro IP da rede local
// - Pode ter sido salvo anteriormente pelo usuário

function isLocalHost(hostname = window.location.hostname) {
  return ["localhost", "127.0.0.1", "0.0.0.0"].includes(hostname);
}

function getApiCandidates() {
  const candidates = [];
  const seen = new Set(); // Para evitar URLs duplicadas

  // Primeiro, tenta a URL salva anteriormente pelo usuário
  const savedApiUrl = localStorage.getItem("apiUrl");

  const addCandidate = (url) => {
    if (!url || seen.has(url)) return; // Ignora duplicatas
    seen.add(url);
    candidates.push(url);
  };

  // Adiciona URL salva pelo usuário (prioridade mais alta)
  if (savedApiUrl) {
    addCandidate(savedApiUrl);
  }

  // Detecta se está rodando via HTTP (não via file://)
  if (window.location.protocol.startsWith("http")) {
    // Em produção (Render), o front e o backend ficam no mesmo domínio.
    // Por isso a origem atual precisa ser testada antes de tentar :3000.
    addCandidate(window.location.origin);

    // Em desenvolvimento, quando o Live Server roda em outra porta,
    // tenta falar com o backend local na porta 3000.
    if (isLocalHost() && window.location.hostname) {
      addCandidate(`http://${window.location.hostname}:3000`);
    }
  }

  // URLs padrão localhost
  addCandidate("http://127.0.0.1:3000");
  addCandidate("http://localhost:3000");

  return candidates;
}

// ============================================================
// FUNÇÃO: PROCESSAR RESPOSTA DO SERVIDOR
// ============================================================
// Padroniza a resposta do servidor, independente do formato.
// O servidor pode retornar JSON ou texto puro.

async function parseResponse(response) {
  // Tenta pegar o Content-Type do headers
  const contentType = response.headers.get("content-type") || "";

  // Se for JSON, parseia normalmente
  if (contentType.includes("application/json")) {
    return response.json();
  }

  // Se não for JSON, retorna texto dentro de objeto padronizado
  const text = await response.text();
  return {
    reply: text || "Resposta vazia do servidor."
  };
}

// ============================================================
// FUNÇÃO: REQUISIÇÃO COM FALLBACK (TENTA MÚLTIPLAS URLS)
// ============================================================
// Tenta fazer a requisição em múltiplas URLs possíveis.
// Se uma falhar, tenta a próxima automaticamente.
// Útil para ambientes de desenvolvimento e redes locais.

async function fetchWithFallback(path, options) {
  const candidates = getApiCandidates();
  let lastError = null;

  // Tenta cada URL Candidate
  for (const baseUrl of candidates) {
    const url = `${baseUrl}${path}`;

    try {
      console.log(`[api] -> ${options.method || "GET"} ${url}`);

      // Faz a requisição fetch
      const response = await fetch(url, {
        ...options,
        mode: "cors" // Permite requisições cross-origin
      });

      // Se funcionou, salva esta URL como preferida
      localStorage.setItem("apiUrl", baseUrl);
      console.log(`[api] <- ${response.status} ${url}`);

      return response; // Retorna a resposta com sucesso

    } catch (error) {
      // Falhou nesta URL, tenta a próxima
      lastError = error;
      console.warn(`[api] Falha de rede em ${url}:`, error);
    }
  }

  // Se nenhuma URL funcionou, lança erro detalhado
  throw new Error(
    `Nao foi possivel conectar ao backend. URLs testadas: ${candidates.join(", ")}. ${lastError?.message || ""}`.trim()
  );
}

// ============================================================
// FUNÇÃO: ENVIAR MENSAGEM DE TEXTO
// ============================================================
// Envia uma mensagem de texto simples para o backend.
// Não inclui arquivos, apenas conversa por texto.

export async function sendMessage(provider, assistantType, message, history, memories = []) {
  // Faz requisição POST para /chat
  const response = await fetchWithFallback("/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      provider,      // "openai" ou "gemini"
      assistantType, // agente empresarial escolhido; ex: financial_management
      message,       // Texto enviado pelo usuário
      history,       // Array com histórico da conversa atual
      memories       // Memorias persistentes do agente, vindas do Supabase
    })
  });

  // Processa a resposta
  const data = await parseResponse(response);

  // Se a resposta não foi ok (200-299), lança erro
  if (!response.ok) {
    console.error("Erro vindo do /chat:", data);
    throw new Error(data.error || data.reply || "Erro ao enviar mensagem.");
  }

  return data;
}

// ============================================================
// FUNÇÃO: ENVIAR ARQUIVO COM MENSAGEM
// ============================================================
// Envia um arquivo (imagem, PDF, texto) junto com uma mensagem.
// Usa FormData para enviar arquivos via POST.

export async function uploadFile(provider, assistantType, message, history, file, memories = []) {
  // Cria FormData para envio multipart/form-data
  const formData = new FormData();

  // Adiciona campos ao FormData
  formData.append("provider", provider);  // IA selecionada
  // Envia o agente junto com o arquivo para o backend manter o mesmo contexto.
  formData.append("assistantType", assistantType); // ex: financial_management
  formData.append("message", message);    // Mensagem opcional
  formData.append("history", JSON.stringify(history)); // Histórico (serializado)
  formData.append("memories", JSON.stringify(memories)); // Memorias persistentes
  formData.append("file", file);          // O arquivo em si

  // Faz requisição POST para /upload
  const response = await fetchWithFallback("/upload", {
    method: "POST",
    body: formData
    // Não precisa setar Content-Type! O browser faz isso automaticamente
    // quando usa FormData
  });

  // Processa a resposta
  const data = await parseResponse(response);

  // Se a resposta não foi ok, lança erro
  if (!response.ok) {
    console.error("Erro vindo do /upload:", data);
    throw new Error(data.error || data.reply || "Erro ao enviar arquivo.");
  }

  return data;
}

// ============================================================
// FUNÇÃO: EXTRAIR MEMÓRIA DA CONVERSA
// ============================================================
// Depois que a IA responde, esta função pergunta ao backend se aquela
// interação contém algum aprendizado duradouro sobre o usuário/empresa.
// Exemplo de memória boa:
// "O usuário acompanha fluxo de caixa semanalmente."
// Exemplo que NÃO deve virar memória:
// "O usuário perguntou o que é fluxo de caixa."

export async function extractMemory(
  provider,
  assistantType,
  userMessage,
  assistantReply,
  history = []
) {
  const response = await fetchWithFallback("/memory/extract", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      provider,
      assistantType,
      userMessage,
      assistantReply,
      history
    })
  });

  const data = await parseResponse(response);

  if (!response.ok) {
    console.error("Erro vindo do /memory/extract:", data);
    throw new Error(data.error || "Erro ao extrair memória.");
  }

  return data.memory || null;
}
