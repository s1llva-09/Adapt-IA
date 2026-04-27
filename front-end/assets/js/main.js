// ============================================================
// PÁGINA INICIAL - Seletor de IA - AdaptIA
// ============================================================
// Este arquivo controla a tela inicial onde o usuário escolhe
// qual IA usar (OpenAI ou Gemini). Depois de escolher, salva
// a preferência e redireciona para a página de chat.
// ============================================================

// ============================================================
// FUNÇÃO: CRIAR MENSAGEM INICIAL
// ============================================================
// Retorna o histórico inicial do chat com a mensagem de
// boas-vindas da IA. Esta mensagem aparece quando o usuário
// inicia uma nova conversa.

function getInitialHistory() {
  return [
    {
      role: "assistant", // Define que é mensagem da IA
      content:
        "Olá! Me diga sobre qual assunto você quer conversar e eu vou me adaptar ao contexto."
    }
  ];
}

// ============================================================
// FUNÇÃO: REDIRECIONAR PARA CHAT (CROSS-ORIGIN)
// ============================================================
// Quando o front-end está em outra porta (ex: arquivo HTML
// aberto diretamente), salva o estado na window.name e
// redireciona para o backend. Isso transfere dados entre
// páginas de origens diferentes.

function redirectToBackendChat(provider, history) {
  // Pega o hostname atual
  const hostname = window.location.hostname || "127.0.0.1";

  // Salva dados na window.name (forma de transferir dados
  // entre páginas sem localStorage compartilhado)
  // window.name sobrevive ao redirecionamento
  window.name = JSON.stringify({
    adaptIaTransfer: {
      provider,  // IA selecionada (openai ou gemini)
      chatHistory: history // Histórico inicial
    }
  });

  // Redireciona para a página de chat no backend
  window.location.href = `http://${hostname}:3000/chat.html`;
}

// ============================================================
// FUNÇÃO: SELECIONAR PROVEDOR (IA)
// ============================================================
// Esta função é chamada quando o usuário clica no botão
// de escolher entre OpenAI ou Gemini. Ela:
// 1. Verifica se precisa redirecionar para o backend
// 2. Salva a escolha no localStorage
// 3. Redireciona para a página de chat

function selectProvider(provider) {
  // Cria histórico inicial com mensagem de boas-vindas
  const initialHistory = getInitialHistory();

  // Verifica se está rodando via HTTP e não na porta do backend
  if (
    window.location.protocol.startsWith("http") &&
    window.location.port !== "3000"
  ) {
    // Se o front-end está em outra porta, redireciona para
    // o backend primeiro para manter estado
    redirectToBackendChat(provider, initialHistory);
    return; // Para execução aqui, o redirect já mudou a página
  }

  // Salva no localStorage (persiste entre sessões)
  localStorage.setItem("provider", provider);
  localStorage.setItem("chatHistory", JSON.stringify(initialHistory));

  // Redireciona para a página de chat
  window.location.href = "chat.html";
}

// ============================================================
// EXPOSIÇÃO GLOBAL
// ============================================================
// Torna a função selectProvider disponível no escopo global
// para ser chamada pelos botões no HTML (onclick inline)

window.selectProvider = selectProvider;