console.log("API.JS NOVO CARREGADO");

function getApiCandidates() {
  const candidates = [];
  const seen = new Set();
  const savedApiUrl = localStorage.getItem("apiUrl");

  const addCandidate = (url) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    candidates.push(url);
  };

  if (savedApiUrl) {
    addCandidate(savedApiUrl);
  }

  if (window.location.protocol.startsWith("http")) {
    if (window.location.port === "3000") {
      addCandidate(window.location.origin);
    }

    if (window.location.hostname) {
      addCandidate(`http://${window.location.hostname}:3000`);
    }
  }

  addCandidate("http://127.0.0.1:3000");
  addCandidate("http://localhost:3000");

  return candidates;
}

async function parseResponse(response) {
  const contentType = response.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    return response.json();
  }

  const text = await response.text();
  return {
    reply: text || "Resposta vazia do servidor."
  };
}

async function fetchWithFallback(path, options) {
  const candidates = getApiCandidates();
  let lastError = null;

  for (const baseUrl of candidates) {
    const url = `${baseUrl}${path}`;

    try {
      console.log(`[api] -> ${options.method || "GET"} ${url}`);

      const response = await fetch(url, {
        ...options,
        mode: "cors"
      });

      localStorage.setItem("apiUrl", baseUrl);
      console.log(`[api] <- ${response.status} ${url}`);

      return response;
    } catch (error) {
      lastError = error;
      console.warn(`[api] Falha de rede em ${url}:`, error);
    }
  }

  throw new Error(
    `Nao foi possivel conectar ao backend. URLs testadas: ${candidates.join(", ")}. ${lastError?.message || ""}`.trim()
  );
}

export async function sendMessage(provider, message, history) {
  const response = await fetchWithFallback("/chat", {
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

  const data = await parseResponse(response);

  if (!response.ok) {
    console.error("Erro vindo do /chat:", data);
    throw new Error(data.error || data.reply || "Erro ao enviar mensagem.");
  }

  return data;
}

export async function uploadFile(provider, message, history, file) {
  const formData = new FormData();

  formData.append("provider", provider);
  formData.append("message", message);
  formData.append("history", JSON.stringify(history));
  formData.append("file", file);

  const response = await fetchWithFallback("/upload", {
    method: "POST",
    body: formData
  });

  const data = await parseResponse(response);

  if (!response.ok) {
    console.error("Erro vindo do /upload:", data);
    throw new Error(data.error || data.reply || "Erro ao enviar arquivo.");
  }

  return data;
}
