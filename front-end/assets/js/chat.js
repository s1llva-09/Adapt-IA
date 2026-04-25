import { pingBackend, sendMessage, uploadFile } from "./api.js";

function getProvider() {
  return localStorage.getItem("provider");
}

function getProviderLabel(value) {
  if (value === "openai") return "OpenAI";
  if (value === "gemini") return "Gemini";
  return "-";
}

function getChatHistory() {
  try {
    return JSON.parse(localStorage.getItem("chatHistory")) || [];
  } catch (error) {
    console.error("Erro ao ler o historico:", error);
    return [];
  }
}

function saveChatHistory(history) {
  try {
    localStorage.setItem("chatHistory", JSON.stringify(history));
  } catch (error) {
    // Se o historico ficar grande demais por causa das miniaturas,
    // salva uma versao compacta sem o preview em base64.
    // Se o localStorage ficar pesado por miniaturas, salva sem preview.
    const compactHistory = history.map((message) => ({
      ...message,
      attachment: message.attachment
        ? {
            name: message.attachment.name,
            type: message.attachment.type
          }
        : null
    }));

    localStorage.setItem("chatHistory", JSON.stringify(compactHistory));
  }
}

function getConversationHistory() {
  // O backend so precisa de role + content.
  // Os anexos sao usados apenas para a interface.
  return getChatHistory().map(({ role, content }) => ({ role, content }));
}

function addMessage(role, content, attachment = null) {
  const history = getChatHistory();
  history.push({ role, content, attachment });
  saveChatHistory(history);
}

function addAssistantHintOnce(content) {
  const history = getChatHistory();
  const last = history[history.length - 1];

  if (last?.role === "assistant" && last?.content === content) {
    return;
  }

  addMessage("assistant", content);
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function formatMarkdown(text) {
  let formatted = escapeHtml(text);

  formatted = formatted.replace(
    /```([\s\S]*?)```/g,
    '<pre class="code-block"><code>$1</code></pre>'
  );

  formatted = formatted.replace(
    /`([^`]+)`/g,
    '<code class="inline-code">$1</code>'
  );

  formatted = formatted.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
  formatted = formatted.replace(/\*(.*?)\*/g, "<em>$1</em>");
  formatted = formatted.replace(/\n/g, "<br>");

  return formatted;
}

function getAvatarLetter(role) {
  return role === "user" ? "U" : "IA";
}

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

async function createImageThumbnail(file) {
  // Primeiro le a imagem como Data URL para podermos desenha-la em um canvas.
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Nao foi possivel ler a imagem."));
    reader.readAsDataURL(file);
  });

  return new Promise((resolve) => {
    const image = new Image();

    image.onload = () => {
      // Reduz a imagem para uma miniatura pequena.
      // Isso deixa o chat visualmente leve e evita estourar o localStorage.
      const maxSide = 180;
      const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
      const width = Math.max(1, Math.round(image.width * scale));
      const height = Math.max(1, Math.round(image.height * scale));
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");

      if (!context) {
        resolve(dataUrl);
        return;
      }

      canvas.width = width;
      canvas.height = height;
      context.drawImage(image, 0, 0, width, height);

      resolve(
        canvas.toDataURL(
          file.type === "image/png" ? "image/png" : "image/jpeg",
          0.82
        )
      );
    };

    image.onerror = () => resolve(dataUrl);
    image.src = dataUrl;
  });
}

async function buildAttachment(file) {
  if (!file) return null;

  // O objeto attachment e o modelo visual do anexo dentro do chat.
  const attachment = {
    name: file.name,
    type: file.type || "application/octet-stream"
  };

  if (attachment.type.startsWith("image/")) {
    try {
      // Para imagens, tambem salvamos uma miniatura para mostrar no historico.
      attachment.previewUrl = await createImageThumbnail(file);
    } catch (error) {
      console.error("Erro ao gerar miniatura:", error);
    }
  }

  return attachment;
}

function createAttachmentElement(role, attachment) {
  // Cria o card visual do anexo que aparece acima da mensagem.
  const card = document.createElement("div");
  card.classList.add(
    "message-attachment",
    role === "user" ? "message-attachment-user" : "message-attachment-assistant"
  );

  const isImage = attachment?.type?.startsWith("image/");

  if (isImage && attachment.previewUrl) {
    // Se for imagem e houver miniatura, mostramos a propria foto.
    const image = document.createElement("img");
    image.classList.add("message-attachment-thumb");
    image.src = attachment.previewUrl;
    image.alt = attachment.name || "Imagem enviada";
    card.appendChild(image);
  } else {
    // Arquivos sem miniatura usam um bloco simples com sigla.
    const icon = document.createElement("div");
    icon.classList.add("message-attachment-icon");
    icon.textContent = isImage ? "IMG" : "ARQ";
    card.appendChild(icon);
  }

  const meta = document.createElement("div");
  meta.classList.add("message-attachment-meta");

  const title = document.createElement("span");
  title.classList.add("message-attachment-title");
  title.textContent = isImage ? "Imagem enviada" : "Arquivo enviado";

  const name = document.createElement("span");
  name.classList.add("message-attachment-name");
  name.textContent = attachment?.name || "Anexo";

  meta.appendChild(title);
  meta.appendChild(name);
  card.appendChild(meta);

  return card;
}

function createMessageElement(role, content = "", useTyping = false, attachment = null) {
  // Cada mensagem tem uma linha, avatar, caixa de conteudo e,
  // opcionalmente, um card de anexo.
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

  if (attachment) {
    // O anexo entra antes do texto para ficar claro que pertence a esta mensagem.
    messageBox.appendChild(createAttachmentElement(role, attachment));
  }

  if (useTyping || content || !attachment) {
    // Se existir texto, mantemos a bolha normal.
    // Se a mensagem tiver apenas anexo, nao criamos uma bolha vazia.
    messageBox.appendChild(bubble);
  }

  if (role === "assistant" && !useTyping && content) {
    // O botao copiar aparece apenas em respostas reais da IA.
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

function renderMessages() {
  const container = document.getElementById("chatMessages");
  if (!container) return;

  // Reconstroi toda a conversa a partir do localStorage,
  // incluindo anexos quando existirem.
  container.innerHTML = "";

  const history = getChatHistory();

  history.forEach((message) => {
    const { wrapper } = createMessageElement(
      message.role,
      message.content || "",
      false,
      message.attachment || null
    );

    container.appendChild(wrapper);
  });

  container.scrollTop = container.scrollHeight;
}

function showTyping() {
  const container = document.getElementById("chatMessages");
  if (!container) return;

  const { wrapper } = createMessageElement(
    "assistant",
    "A IA esta digitando...",
    true
  );

  wrapper.id = "typingIndicator";
  container.appendChild(wrapper);
  container.scrollTop = container.scrollHeight;
}

function removeTyping() {
  const typing = document.getElementById("typingIndicator");
  if (typing) typing.remove();
}

function clearChat() {
  saveChatHistory([
    {
      role: "assistant",
      content: "Conversa limpa. Sobre o que vamos falar agora?"
    }
  ]);

  renderMessages();
}

function goBack() {
  window.location.href = "index.html";
}

function toggleSidebar() {
  document.body.classList.toggle("sidebar-collapsed");

  const isCollapsed = document.body.classList.contains("sidebar-collapsed");
  localStorage.setItem("sidebarState", isCollapsed ? "closed" : "open");
}

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

async function typeMessage(content) {
  const container = document.getElementById("chatMessages");
  if (!container) return;

  const { wrapper, bubble } = createMessageElement("assistant", "");
  container.appendChild(wrapper);

  let partial = "";

  for (let index = 0; index < content.length; index += 1) {
    partial += content[index];
    bubble.innerHTML = formatMarkdown(partial);
    container.scrollTop = container.scrollHeight;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function clearSelectedFilePreview() {
  // Limpa o estado visual do anexo no composer depois do envio.
  const fileInput = document.getElementById("fileInput");
  const filePreview = document.getElementById("filePreview");
  const fileNamePreview = document.getElementById("fileNamePreview");

  if (fileInput) fileInput.value = "";
  if (filePreview) filePreview.innerHTML = "";
  if (fileNamePreview) fileNamePreview.textContent = "";
}

function renderSelectedFilePreview(file) {
  const filePreview = document.getElementById("filePreview");
  const fileNamePreview = document.getElementById("fileNamePreview");

  if (!filePreview || !fileNamePreview) return;

  // Sempre limpa o preview anterior antes de desenhar o novo.
  filePreview.innerHTML = "";
  fileNamePreview.textContent = "";

  if (!file) return;

  if (file.type.startsWith("image/")) {
    // Antes do envio, usamos Object URL para mostrar um preview rapido da imagem.
    const image = document.createElement("img");
    const objectUrl = URL.createObjectURL(file);

    image.src = objectUrl;
    image.alt = file.name;
    image.onload = () => URL.revokeObjectURL(objectUrl);

    const name = document.createElement("span");
    name.textContent = file.name;

    filePreview.appendChild(image);
    filePreview.appendChild(name);
    return;
  }

  filePreview.innerHTML = `<span>${escapeHtml(file.name)}</span>`;
}

async function handleSubmit(event) {
  if (event) event.preventDefault();

  const input = document.getElementById("messageInput");
  const fileInput = document.getElementById("fileInput");
  const file = fileInput?.files[0];
  const provider = getProvider();

  if (!input || !provider) return;

  const message = input.value.trim();
  // Este historico e capturado antes de salvar a nova mensagem na interface.
  // Assim evitamos mandar dados duplicados para o backend.
  const historyBeforeSubmit = getConversationHistory();

  if (!message && !file) {
    console.info("[chat] Envio ignorado: sem texto e sem arquivo selecionado.");
    addAssistantHintOnce(
      "Digite uma mensagem ou selecione o arquivo novamente para eu responder."
    );
    renderMessages();
    return;
  }

  // O anexo e preparado para a interface antes do envio da requisicao.
  const attachment = file ? await buildAttachment(file) : null;

  // Salva imediatamente no historico para o usuario ver o que enviou.
  addMessage("user", message, attachment);
  renderMessages();

  input.value = "";
  input.style.height = "auto";
  showTyping();

  try {
    const data = file
      ? await uploadFile(
          provider,
          message || "Analise este arquivo.",
          // No upload, o backend recebe apenas a conversa anterior.
          // A mensagem atual vai separada no multipart/form-data.
          historyBeforeSubmit,
          file
        )
      : await sendMessage(
          provider,
          message,
          // No chat de texto puro, a mensagem atual ja entra junto no array.
          [...historyBeforeSubmit, { role: "user", content: message }]
        );

    clearSelectedFilePreview();

    const reply = data.reply || "Sem resposta da IA.";

    removeTyping();
    addMessage("assistant", reply);
    renderMessages();
  } catch (error) {
    removeTyping();

    addMessage(
      "assistant",
      error?.message || "Desculpe, houve um erro ao conectar com o servidor."
    );

    renderMessages();
    console.error("Erro ao enviar a mensagem:", error);
  }
}

async function initializeChat() {
  const provider = getProvider();
  const providerLabel = document.getElementById("providerLabel");
  const form = document.getElementById("chatForm");
  const sendButton = document.getElementById("sendButton");
  const fileInput = document.getElementById("fileInput");

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
          "Ola! Me diga sobre qual assunto voce quer conversar e eu vou me adaptar ao contexto."
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

  if (fileInput) {
    fileInput.addEventListener("change", () => {
      // Sempre que o usuario troca o arquivo, atualizamos o preview do composer.
      renderSelectedFilePreview(fileInput.files[0]);
    });
  }

  // Verificacao do backend sem bloquear o registro dos eventos da tela.
  pingBackend()
    .then((health) => {
      console.info("[chat] Backend online:", health);
    })
    .catch((error) => {
      console.error("[chat] Backend indisponivel:", error);
    });
}

window.clearChat = clearChat;
window.goBack = goBack;
window.toggleSidebar = toggleSidebar;

window.addEventListener("error", (event) => {
  console.error("[chat] Erro nao tratado:", event.error || event.message);
});

window.addEventListener("unhandledrejection", (event) => {
  console.error("[chat] Promise rejeitada sem tratamento:", event.reason);
});

document.addEventListener("DOMContentLoaded", initializeChat);
