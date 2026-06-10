// ============================================================
// PÁGINA INICIAL - Seletor de IA - AdaptIA
// ============================================================
// Este arquivo controla a tela inicial onde o usuário escolhe
// qual IA usar (OpenAI ou Gemini). Depois de escolher, salva
// a preferência e redireciona para a página de chat.
// ============================================================
//acessa as paginas apenas se estiver logado
import { protectPage, getSession } from "./auth.js";
import { fetchWithFallback } from "./api.js";
protectPage();

// Provider padrão usado quando o usuário ainda não escolheu Gemini/OpenAI.
// Por enquanto Gemini fica como padrão porque costuma ser o caminho gratuito.
const DEFAULT_PROVIDER = "gemini";

// Identificador técnico do agente de Gestão Financeira.
// Esse valor precisa ser igual no front-end e no back-end.
const FINANCIAL_ASSISTANT_TYPE = "financial_management";

// ============================================================
// FUNÇÃO: CRIAR MENSAGEM INICIAL
// ============================================================
// Retorna o histórico inicial do chat com a mensagem de
// boas-vindas da IA. Esta mensagem aparece quando o usuário
// inicia uma nova conversa.

function getInitialHistory(assistantType = null) {
  // Se o usuário iniciou pelo agente financeiro, a primeira mensagem
  // já deixa claro qual papel a IA vai assumir.
  if (assistantType === FINANCIAL_ASSISTANT_TYPE) {
    return [
      {
        role: "assistant",
        content:
          "Olá! Sou seu agente de Gestão Financeira. Posso ajudar com fluxo de caixa, contas a pagar, contas a receber, custos, precificação e relatórios."
      }
    ];
  }

  return [
    {
      role: "assistant", // Define que é mensagem da IA
      content:
        "Olá! Me diga sobre qual assunto você quer conversar e eu vou me adaptar ao contexto."
    }
  ];
}

function isLocalHost() {
  return ["localhost", "127.0.0.1", "0.0.0.0"].includes(
    window.location.hostname
  );
}

// ============================================================
// FUNÇÃO: REDIRECIONAR PARA CHAT (CROSS-ORIGIN)
// ============================================================
// Quando o front-end está em outra porta (ex: arquivo HTML
// aberto diretamente), salva o estado na window.name e
// redireciona para o backend. Isso transfere dados entre
// páginas de origens diferentes.

function redirectToBackendChat(provider, history, assistantType = null) {
  // Pega o hostname atual
  const hostname = window.location.hostname || "127.0.0.1";

  // Salva dados na window.name (forma de transferir dados
  // entre páginas sem localStorage compartilhado)
  // window.name sobrevive ao redirecionamento
  window.name = JSON.stringify({
    adaptIaTransfer: {
      provider,  // IA selecionada (openai ou gemini)
      assistantType, // agente empresarial selecionado
      chatHistory: history // Histórico inicial
    }
  });

  // Redireciona para a página de chat no backend
  window.location.href = `http://${hostname}:3000/chat.html`;
}

// Retorna o motor selecionado na tela.
function getSelectedProvider() {
  // Procura na tela qual botão está marcado com is-selected.
  // Se não encontrar, usa o que estiver salvo no navegador.
  // Se também não houver nada salvo, cai no provider padrão.
  const selectedButton = document.querySelector("[data-provider].is-selected");
  return selectedButton?.dataset.provider || localStorage.getItem("provider") || DEFAULT_PROVIDER;
}

// Marca visualmente o botão Gemini/OpenAI e salva a escolha.
function setSelectedProvider(provider) {
  // Salva para que a tela de chat saiba qual motor usar.
  localStorage.setItem("provider", provider);

  // Atualiza o visual dos botões: só o provider clicado fica selecionado.
  document.querySelectorAll("[data-provider]").forEach((button) => {
    button.classList.toggle("is-selected", button.dataset.provider === provider);
  });
}

// Ativa a troca entre Gemini e OpenAI na tela inicial.
function setupProviderButtons() {
  // Ao abrir a tela, mantém marcado o provider salvo anteriormente.
  setSelectedProvider(getSelectedProvider());

  // Cada clique em Gemini/OpenAI troca a seleção e salva no localStorage.
  document.querySelectorAll("[data-provider]").forEach((button) => {
    button.addEventListener("click", () => {
      setSelectedProvider(button.dataset.provider);
    });
  });
}

// ============================================================
// FUNCAO: CONFIGURAR BOTAO VOLTAR
// ============================================================
// Esta funcao liga o clique do botao "Voltar" da tela de agentes.
// A ideia aqui nao e voltar para o chat nem para a pagina anterior do navegador:
// nesta tela, "Voltar" significa sair da escolha de agentes e retornar ao login.
// Por isso usamos login.html diretamente, deixando o comportamento previsivel.
function setupBackButton() {
  // Busca no HTML o botao que tem data-back-button.
  // Se o botao nao existir na pagina, a funcao para aqui sem gerar erro.
  const backButton = document.querySelector("[data-back-button]");

  if (!backButton) return;

  // Quando clicar, redireciona para a tela de login.
  backButton.addEventListener("click", () => {
    window.location.href = "login.html";
  });
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

  // Verifica se está rodando localmente via HTTP e não na porta do backend
  if (
    isLocalHost() &&
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

// ==========================================
// FUNÇÃO: abrirGestaoFinanceira
// ==========================================
function abrirGestaoFinanceira() {
  // Pega Gemini ou OpenAI de acordo com o botão selecionado na tela.
  const provider = getSelectedProvider();

  // Cria uma mensagem inicial já contextualizada para o agente financeiro.
  const initialHistory = getInitialHistory(FINANCIAL_ASSISTANT_TYPE);

  if (
    isLocalHost() &&
    window.location.protocol.startsWith("http") &&
    window.location.port !== "3000"
  ) {
    redirectToBackendChat(provider, initialHistory, FINANCIAL_ASSISTANT_TYPE);
    return;
  }

  // Salva qual agente o usuário escolheu.
  // O chat.js vai ler esse valor e enviar para o backend.
  localStorage.setItem("assistantType", FINANCIAL_ASSISTANT_TYPE)

  // Salva qual motor de IA vai ser usado: Gemini ou OpenAI.
  localStorage.setItem("provider", provider)

  // Salva a primeira mensagem localmente, para o chat abrir já contextualizado.
  localStorage.setItem("chatHistory", JSON.stringify(initialHistory))

  // Remove a conversa antiga para começar uma nova conversa financeira.
  localStorage.removeItem("currentConversationId")

  // Redireciona para a tela do chat.
  window.location.href = "chat.html"
}

//Permite chamar a função direto do html
window.abrirGestaoFinanceira = abrirGestaoFinanceira

// Mostra o link do Painel Admin no topbar apenas se o usuário for admin
async function setupAdminLink() {
  const session = await getSession();
  if (!session) return;

  try {
    const res = await fetchWithFallback("/profile", {
      method: "GET",
      headers: { Authorization: `Bearer ${session.access_token}` }
    });
    const data = await res.json();
    if (data.profile?.role === "admin") {
      document.getElementById("adminNavLink")?.classList.remove("hidden");
    }
  } catch (e) {
    // Perfil indisponível, não mostra o link
  }
}

document.addEventListener("DOMContentLoaded", () => {
  setupProviderButtons();
  setupBackButton();
  setupAdminLink();
});

// ============================================================
// EXPOSIÇÃO GLOBAL
// ============================================================
// Torna a função selectProvider disponível no escopo global
// para ser chamada pelos botões no HTML (onclick inline)

window.selectProvider = selectProvider;
