import { sendMessage } from "./api.js";

// Retorna a IA escolhida
function getProvider() {
  return localStorage.getItem("provider");
}

// Converte o valor salvo em texto bonito
function getProviderLabel(value) {
  if (value === "openai") return "OpenAI";
  if (value === "gemini") return "Gemini";
  return "-";
}

// Pega o histórico salvo
function getChatHistory() {
  return JSON.parse(localStorage.getItem("chatHistory")) || [];
}

// Salva o histórico
function saveChatHistory(history) {
  localStorage.setItem("chatHistory", JSON.stringify(history));
}

// Adiciona uma mensagem nova ao histórico
function addMessage(role, content) {
  const history = getChatHistory();
  history.push({ role, content });
  saveChatHistory(history);
}

// Escapa HTML para evitar renderização perigosa
function escapeHtml(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

// Faz uma formatação simples de markdown
function formatMarkdown(text) {
  let formatted = escapeHtml(text);

  // bloco de código ``` ```
  formatted = formatted.replace(
    /```([\s\S]*?)```/g,
    '<pre class="code-block"><code>$1</code></pre>'
  );

  // código inline ` `
  formatted = formatted.replace(
    /`([^`]+)`/g,
    '<code class="inline-code">$1</code>'
  );

  // negrito ** **
  formatted = formatted.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");

  // itálico * *
  formatted = formatted.replace(/\*(.*?)\*/g, "<em>$1</em>");

  // quebra de linha
  formatted = formatted.replace(/\n/g, "<br>");

  return formatted;
}

// Letra do avatar
function getAvatarLetter(role) {
  return role === "user" ? "U" : "IA";
}

// Copia texto para a área de transferência
async function copyToClipboard(text, button) {
  try {
    await navigator.clipboard.writeText(text);

    const originalText = button.textContent;
    button.textContent = "Copiado!";

    setTimeout(() => {
      button.textContent = originalText;
    }, 1200);
  } catch (error) {
    console.error("Erro ao copiar:", error);
    button.textContent = "Erro";

    setTimeout(() => {
      button.textContent = "Copiar";
    }, 1200);
  }
}

// Cria uma mensagem visualmente
function createMessageElement(role, content, useTyping = false) {
  const wrapper = document.createElement("div");
  wrapper.classList.add(
    "message-row",
    role === "user" ? "row-user" : "row-assistant"
  );

  const avatar = document.createElement("div");
  avatar.classList.add(
    "avatar",
    role === "user" ? "avatar-user" : "avatar-assistant"
  );
  avatar.textContent = getAvatarLetter(role);

  const messageBox = document.createElement("div");
  messageBox.classList.add("message-box");

  const bubble = document.createElement("div");
  bubble.classList.add("message", role === "user" ? "user" : "assistant");

  if (useTyping) {
    bubble.classList.add("typing");
    bubble.textContent = content;
  } else {
    bubble.innerHTML = formatMarkdown(content);
  }

  messageBox.appendChild(bubble);

  // Botão copiar só para mensagens da IA e não para typing
  if (role === "assistant" && !useTyping) {
    const actions = document.createElement("div");
    actions.classList.add("message-actions");

    const copyButton = document.createElement("button");
    copyButton.classList.add("copy-btn");
    copyButton.type = "button";
    copyButton.textContent = "Copiar";

    copyButton.addEventListener("click", () => {
      copyToClipboard(content, copyButton);
    });

    actions.appendChild(copyButton);
    messageBox.appendChild(actions);
  }

  if (role === "user") {
    wrapper.appendChild(messageBox);
    wrapper.appendChild(avatar);
  } else {
    wrapper.appendChild(avatar);
    wrapper.appendChild(messageBox);
  }

  return { wrapper, bubble };
}

// Renderiza mensagens na tela
function renderMessages() {
  const container = document.getElementById("chatMessages");
  if (!container) return;

  container.innerHTML = "";

  const history = getChatHistory();

  history.forEach((msg) => {
    const { wrapper } = createMessageElement(msg.role, msg.content);
    container.appendChild(wrapper);
  });

  container.scrollTop = container.scrollHeight;
}

// Mostra digitando...
function showTyping() {
  const container = document.getElementById("chatMessages");
  if (!container) return;

  const { wrapper } = createMessageElement(
    "assistant",
    "A IA está digitando...",
    true
  );

  wrapper.id = "typingIndicator";
  container.appendChild(wrapper);
  container.scrollTop = container.scrollHeight;
}

// Remove digitando...
function removeTyping() {
  const typing = document.getElementById("typingIndicator");
  if (typing) typing.remove();
}

// Limpa o chat
function clearChat() {
  const initialHistory = [
    {
      role: "assistant",
      content: "Conversa limpa. Sobre o que vamos falar agora?"
    }
  ];

  saveChatHistory(initialHistory);
  renderMessages();
}

// Volta para tela inicial
function goBack() {
  window.location.href = "index.html";
}

// Abre e fecha sidebar
function toggleSidebar() {
  document.body.classList.toggle("sidebar-collapsed");

  const isCollapsed = document.body.classList.contains("sidebar-collapsed");
  localStorage.setItem("sidebarState", isCollapsed ? "closed" : "open");
}

// Configura textarea
function setupTextarea() {
  const textarea = document.getElementById("messageInput");
  if (!textarea) return;

  const autoResize = () => {
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  };

  textarea.addEventListener("input", autoResize);

  textarea.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();

      const form = document.getElementById("chatForm");
      if (form) form.requestSubmit();
    }
  });

  autoResize();
}

// Efeito digitando
async function typeMessage(content) {
  const container = document.getElementById("chatMessages");
  if (!container) return;

  const { wrapper, bubble } = createMessageElement("assistant", "");
  container.appendChild(wrapper);

  let partial = "";

  for (let i = 0; i < content.length; i++) {
    partial += content[i];
    bubble.innerHTML = formatMarkdown(partial);
    container.scrollTop = container.scrollHeight;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

// Envio do formulário
async function handleSubmit(event) {
  event.preventDefault();

  const input = document.getElementById("messageInput");
  const provider = getProvider();

  if (!input || !provider) return;

  const message = input.value.trim();
  if (!message) return;

  addMessage("user", message);
  renderMessages();

  input.value = "";
  input.style.height = "auto";

  showTyping();

  try {
    const data = await sendMessage(provider, message, getChatHistory());
    const reply = data.reply || "Sem resposta da IA.";

    removeTyping();
    renderMessages();

    await typeMessage(reply);

    addMessage("assistant", reply);
    renderMessages();
  } catch (error) {
    removeTyping();

    addMessage(
      "assistant",
      "Desculpe, houve um erro ao conectar com o servidor."
    );

    renderMessages();
    console.error("erro ao enviar a mensagem:", error);
  }
}

// Inicializa o chat
function initializeChat() {
  const provider = getProvider();
  const providerLabel = document.getElementById("providerLabel");
  const form = document.getElementById("chatForm");

  if (!provider) {
    window.location.href = "index.html";
    return;
  }

  if (providerLabel) {
    providerLabel.textContent = getProviderLabel(provider);
  }

  if (getChatHistory().length === 0) {
    saveChatHistory([
      {
        role: "assistant",
        content:
          "Olá! Me diga sobre qual assunto você quer conversar e eu vou me adaptar ao contexto."
      }
    ]);
  }

  const sidebarState = localStorage.getItem("sidebarState");
  if (sidebarState === "closed") {
    document.body.classList.add("sidebar-collapsed");
  }

  renderMessages();
  setupTextarea();

  if (form) {
    form.addEventListener("submit", handleSubmit);
  }
}

window.clearChat = clearChat;
window.goBack = goBack;
window.toggleSidebar = toggleSidebar;

document.addEventListener("DOMContentLoaded", initializeChat);