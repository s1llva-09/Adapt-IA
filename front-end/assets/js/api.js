// URL base do backend.
// O front-end manda requisições para esse endereço.
const API_URL = "http://localhost:3000";

// Função para enviar uma mensagem normal, sem arquivo.
export async function sendMessage(provider, message, history) {
  // Faz uma requisição POST para a rota /chat do backend.
  const response = await fetch(`${API_URL}/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      provider, // IA escolhida: openai ou gemini
      message,  // mensagem digitada pelo usuário
      history   // histórico da conversa
    })
  });

  // Converte a resposta do backend para objeto JavaScript.
  const data = await response.json();

  // Se o backend retornar erro, mostra no console e lança erro.
  if (!response.ok) {
    console.error("Erro vindo do backend:", data);
    throw new Error(data.error || data.reply || "Erro ao enviar mensagem.");
  }

  // Retorna os dados para o chat.js.
  return data;
}

// Função para enviar arquivo + mensagem para o backend.
export async function uploadFile(provider, message, history, file) {
  // FormData é obrigatório para enviar arquivos.
  // Não usamos JSON quando existe arquivo.
  const formData = new FormData();

  // Adiciona os dados no formulário.
  formData.append("provider", provider);
  formData.append("message", message);
  formData.append("history", JSON.stringify(history));
  formData.append("file", file);

  // Envia para a rota /upload.
  // IMPORTANTE: não coloque Content-Type aqui.
  // O navegador define multipart/form-data automaticamente.
  const response = await fetch(`${API_URL}/upload`, {
    method: "POST",
    body: formData
  });

  // Mostra o status para debug.
  console.log("Status do upload:", response.status);

  // Converte a resposta do backend.
  const data = await response.json();

  // Mostra o retorno final para debug.
  console.log("Resposta final do upload:", data);

  // Se o backend retornar erro, lança erro.
  if (!response.ok) {
    console.error("Erro vindo do upload:", data);
    throw new Error(data.error || data.reply || "Erro ao enviar arquivo.");
  }

  // Retorna a resposta para o chat.js.
  return data;
}