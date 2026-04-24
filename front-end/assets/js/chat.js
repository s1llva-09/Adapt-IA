import { sendMessage, uploadFile } from "./api.js";

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

      handleSubmit(event);
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

// Função chamada quando o formulário é enviado (clicar em "Enviar" ou Enter)
async function handleSubmit(event) {
  // Impede o comportamento padrão do formulário (recarregar a página)
  if (event) event.preventDefault();

  // Pega o input de texto
  const input = document.getElementById("messageInput");

  // Pega o input de arquivo (📎)
  const fileInput = document.getElementById("fileInput");

  // Pega o arquivo selecionado (se existir)
  // ?. evita erro caso fileInput seja null
  const file = fileInput?.files[0];

  // Debug: mostra no console o arquivo selecionado
  console.log("Arquivo selecionado:", file);

  // Pega qual IA foi selecionada (OpenAI ou Gemini)
  const provider = getProvider();

  // Se não tiver input ou provider, não continua
  if (!input || !provider) return;

  // Pega a mensagem digitada e remove espaços extras
  const message = input.value.trim();

  // Se não tiver mensagem E nem arquivo, não envia nada
  if (!message && !file) return;

  // Adiciona mensagem do usuário no histórico
  // Se não tiver texto, mostra que enviou arquivo
  addMessage("user", message || `Arquivo enviado: ${file.name}`);

  // Atualiza o chat na tela
  renderMessages();

  // Limpa o campo de texto
  input.value = "";

  // Reseta altura do textarea (auto resize)
  input.style.height = "auto";

  // Mostra "IA está digitando..."
  showTyping();

  try {
    // Se tiver arquivo → usa uploadFile
    // Senão → usa sendMessage normal
    const data = file
      ? await uploadFile(
          provider, // qual IA usar
          message || "Analise este arquivo.", // mensagem padrão se não tiver texto
          getChatHistory(), // histórico da conversa
          file // arquivo enviado
        )
      : await sendMessage(
          provider,
          message,
          getChatHistory()
        );

    // Limpa o input de arquivo (remove o arquivo selecionado)
    if (fileInput) fileInput.value = "";

    // Limpa preview visual (imagem ou nome)
    const filePreview = document.getElementById("filePreview");
    if (filePreview) filePreview.innerHTML = "";

    // Limpa o nome do arquivo exibido na tela (caso use span separado)
    const fileNamePreview = document.getElementById("fileNamePreview");
    if (fileNamePreview) fileNamePreview.textContent = "";

    // Pega a resposta da IA
    const reply = data.reply || "Sem resposta da IA.";

    // Remove o "digitando..."
    removeTyping();

    // Renderiza novamente (limpa e atualiza)
    renderMessages();

    // Mostra resposta com efeito digitando
    await typeMessage(reply);

    // Salva resposta da IA no histórico
    addMessage("assistant", reply);

    // Atualiza novamente o chat
    renderMessages();

  } catch (error) {
    // Se der erro → remove "digitando"
    removeTyping();

    // Mostra mensagem de erro no chat
    addMessage(
      "assistant",
      "Desculpe, houve um erro ao conectar com o servidor."
    );

    // Atualiza tela
    renderMessages();

    // Mostra erro real no console (debug)
    console.error("erro ao enviar a mensagem:", error);
  }
}

// Inicializa o chat
function initializeChat() {
  const provider = getProvider();
  const providerLabel = document.getElementById("providerLabel");
  const form = document.getElementById("chatForm");
  const sendButton = document.getElementById("sendButton");

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

  if (sendButton) {
    sendButton.addEventListener("click", handleSubmit);
  }

  if (form) {
    form.addEventListener("submit", handleSubmit);
  }

  const fileInput = document.getElementById("fileInput"); // busca o elemento fileInput
  const fileNamePreview = document.getElementById("fileNamePreview"); // busca o elemento onde irá mostrar o nome do arquivo
  const filePreview = document.getElementById("filePreview"); // busca o elemento onde irá mostrar o preview do arquivo ou imagem

  if (fileInput) { // verifica se o input de arquivo existe
    fileInput.addEventListener("change", () => { // aciona o evento quando é importado um arquivo ou quando troca etc.
      const file = fileInput.files[0]; // cria uma lista para os arquivos e pega o primeiro deles ([0])

      if (fileNamePreview) { // verifica se o elemento do nome do arquivo existe
        fileNamePreview.textContent = file ? file.name : ""; // se o arquivo existir mostra o nome dele, se não limpa o texto
      }

      if (filePreview) { // verifica se o elemento de preview existe
        filePreview.innerHTML = ""; // limpa o preview anterior antes de mostrar o novo arquivo

        if (!file) return; // se não tiver arquivo selecionado, para a função

        if (file.type.startsWith("image/")) { // verifica se o arquivo selecionado é uma imagem
          const img = document.createElement("img"); // cria uma tag img para mostrar a imagem na tela
          img.src = URL.createObjectURL(file); // cria uma URL temporária para exibir a imagem selecionada

          const span = document.createElement("span"); // cria um span para mostrar o nome do arquivo
          span.textContent = file.name; // coloca o nome do arquivo dentro do span

          filePreview.appendChild(img); // adiciona a imagem dentro do preview
          filePreview.appendChild(span); // adiciona o nome do arquivo dentro do preview
        } else {
          filePreview.innerHTML = `<span>${file.name}</span>`; // se não for imagem, mostra apenas o nome do arquivo
        }
      }
    });
  }
}

window.clearChat = clearChat;
window.goBack = goBack;
window.toggleSidebar = toggleSidebar;

document.addEventListener("DOMContentLoaded", initializeChat);