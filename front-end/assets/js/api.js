// O front-end conversa com o backend, e o backend conversa com OpenAI/Gemini.
const API_PORT = 3000;
let activeApiBase = null;

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || "").trim().replace(/\/+$/, "");
}

function getApiBaseCandidates() {
  // Permite override manual no navegador para debug:
  // localStorage.setItem("apiUrl", "http://127.0.0.1:3000")
  const manualBase = normalizeBaseUrl(localStorage.getItem("apiUrl"));

  if (manualBase) {
    return [manualBase];
  }

  const protocol = "http:";
  const hosts = [
    window.location?.hostname,
    "localhost",
    "127.0.0.1"
  ].filter(Boolean);

  const uniqueHosts = [...new Set(hosts)];

  return uniqueHosts.map((host) => `${protocol}//${host}:${API_PORT}`);
}

function createNetworkError(error, endpoint, attemptedUrls) {
  const attemptedList = attemptedUrls.map((url) => `${url}${endpoint}`).join(", ");
  const networkError = new Error(
    `Nao foi possivel conectar no backend (${attemptedList}). Verifique se o servidor esta rodando.`
  );

  networkError.code = "NETWORK_ERROR";
  networkError.cause = error;
  networkError.attemptedUrls = attemptedUrls;

  return networkError;
}

async function parseResponseBody(response) {
  const contentType = response.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    return response.json();
  }

  const text = await response.text();
  return { reply: text || null };
}

async function fetchWithFallback(endpoint, options) {
  const candidates = getApiBaseCandidates();
  const orderedCandidates = activeApiBase
    ? [activeApiBase, ...candidates.filter((base) => base !== activeApiBase)]
    : candidates;

  let lastError = null;

  for (const baseUrl of orderedCandidates) {
    const url = `${baseUrl}${endpoint}`;
    console.info(`[api] -> ${options.method || "GET"} ${url}`);

    try {
      const response = await fetch(url, options);
      activeApiBase = baseUrl;
      return { response, url };
    } catch (error) {
      lastError = error;
      console.warn(`[api] Falha de rede em ${url}:`, error);
    }
  }

  throw createNetworkError(lastError, endpoint, orderedCandidates);
}

async function request(endpoint, options) {
  const startedAt = Date.now();
  const { response, url } = await fetchWithFallback(endpoint, options);

  let data = {};

  try {
    data = await parseResponseBody(response);
  } catch (error) {
    console.error("[api] Falha ao ler resposta do backend:", error);
  }

  const duration = Date.now() - startedAt;
  console.info(`[api] <- ${response.status} ${url} (${duration}ms)`);

  if (!response.ok) {
    const backendMessage =
      data?.reply || data?.error || `Erro HTTP ${response.status}`;
    const backendError = new Error(backendMessage);

    backendError.status = response.status;
    backendError.response = data;
    backendError.url = url;

    console.error("[api] Erro retornado pelo backend:", backendError);
    throw backendError;
  }

  return data;
}

export async function pingBackend() {
  return request("/health", { method: "GET" });
}

export async function sendMessage(provider, message, history) {
  return request("/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      provider,
      message,
      history
    })
  });
}

export async function uploadFile(provider, message, history, file) {
  const formData = new FormData();

  formData.append("provider", provider);
  formData.append("message", message);
  formData.append("history", JSON.stringify(history));
  formData.append("file", file);

  return request("/upload", {
    method: "POST",
    body: formData
  });
}
