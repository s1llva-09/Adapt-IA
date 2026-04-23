// Esta função é usada na tela inicial.
// Ela salva qual IA o usuário escolheu
// e depois leva ele para a página do chat.
function selectProvider(provider) {
  // Salva o provider escolhido no navegador.
  // Exemplos:
  // "openai"
  // "gemini"
  localStorage.setItem("provider", provider);

  // Cria um histórico inicial do chat.
  // Assim o chat abre já com uma mensagem da IA,
  // em vez de abrir completamente vazio.
  localStorage.setItem(
    "chatHistory",
    JSON.stringify([
      {
        role: "assistant",
        content:
          "Olá! Me diga sobre qual assunto você quer conversar e eu vou me adaptar ao contexto."
      }
    ])
  );

  // Redireciona para a tela do chat
  window.location.href = "chat.html";
}

// Como no HTML você usa onclick="selectProvider('openai')",
// precisamos deixar essa função disponível no escopo global.
window.selectProvider = selectProvider;