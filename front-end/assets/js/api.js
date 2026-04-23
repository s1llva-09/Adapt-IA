// URL base do backend.
// O front-end conversa com o backend,
// e o backend conversa com OpenAI/Gemini.
const API_URL = "http://localhost:3000";

// Esta função envia a mensagem do usuário para o backend.
export async function sendMessage(provider, message, history) {
  // Faz uma requisição POST para a rota /chat
  const response = await fetch(`${API_URL}/chat`, {
    method: "POST",
    headers: {
      // Diz que estamos enviando JSON
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      provider, // IA escolhida
      message,  // mensagem atual
      history   // histórico da conversa
    })
  });

  // Converte a resposta para objeto JavaScript
  const data = await response.json();

  // Se o backend respondeu com erro,
  // mostramos o erro no console e lançamos uma exceção.
  if (!response.ok) {
    console.error("Erro vindo do backend:", data);
    throw new Error(data.reply || "Erro ao enviar mensagem para o servidor.");
  }

  // Retorna os dados da resposta
  return data;
}