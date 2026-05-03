console.log("CHAT.JS NOVO CARREGADO");
// Importa as funções que conversam com o backend.
import { sendMessage, uploadFile } from "./api.js";
import { protectPage, logout } from "./auth.js";
import {
  createConversation,
  getMessages,
  saveMessage
} from "./database.js";

// Garante que apenas usuarios logados acessem o chat.
// Se nao houver sessao ativa no Supabase, auth.js redireciona para login.html.
protectPage();

function getBackendOrigin() {
  const hostname = window.location.hostname || "127.0.0.1";
  return `http://${hostname}:3000`;
}

function isLocalHost() {
  return ["localhost", "127.0.0.1", "0.0.0.0"].includes(
    window.location.hostname
  );
}

function getTransferState() {
  try {
    const parsed = JSON.parse(window.name || "{}");
    return parsed.adaptIaTransfer || null;
  } catch (error) {
    console.error("Erro ao ler estado de transicao:", error);
    return null;
  }
}

function saveTransferState() {
  try {
    const history = getChatHistory().map(({ role, content }) => ({
      role,
      content
    }));

    window.name = JSON.stringify({
      adaptIaTransfer: {
        provider: getProvider(),
        chatHistory: history
      }
    });
  } catch (error) {
    console.error("Erro ao salvar estado de transicao:", error);
  }
}

function restoreTransferState() {
  const transferState = getTransferState();

  if (!transferState) return;

  if (transferState.provider && !localStorage.getItem("provider")) {
    localStorage.setItem("provider", transferState.provider);
  }

  const hasLocalHistory = getChatHistory().length > 0;

  if (!hasLocalHistory && Array.isArray(transferState.chatHistory)) {
    saveChatHistory(transferState.chatHistory);
  }

  window.name = "";
}

function redirectToBackendOriginIfNeeded() {
  if (!window.location.protocol.startsWith("http")) return false;
  if (!isLocalHost()) return false;
  if (window.location.port === "3000") return false;

  saveTransferState();

  const fileName = window.location.pathname.split("/").pop() || "chat.html";
  window.location.replace(`${getBackendOrigin()}/${fileName}`);

  return true;
}

// Retorna a IA escolhida salva no navegador.
function getProvider() {
  return localStorage.getItem("provider");
}

// Converte o valor técnico em nome bonito para exibir na tela.
function getProviderLabel(value) {
  if (value === "openai") return "OpenAI";
  if (value === "gemini") return "Gemini";
  return "-";
}

// Busca o histórico salvo no localStorage.
function getChatHistory() {
  try {
    return JSON.parse(localStorage.getItem("chatHistory")) || [];
  } catch (error) {
    console.error("Erro ao ler o histórico:", error);
    return [];
  }
}

// Salva o histórico no localStorage.
function saveChatHistory(history) {
  try {
    localStorage.setItem("chatHistory", JSON.stringify(history));
  } catch (error) {
    console.error("Erro ao salvar histórico:", error);

    // Caso o histórico fique pesado por causa de preview de imagem,
    // salva uma versão mais leve.
    const compactHistory = history.map((message) => ({
      role: message.role,
      content: message.content,
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

// Adiciona uma nova mensagem ao histórico.
function addMessage(role, content, attachment = null) {
  const history = getChatHistory();
  history.push({ role, content, attachment });
  saveChatHistory(history);
}

// Retorna apenas role/content para enviar ao backend.
// Isso evita mandar preview base64 da imagem para a IA.
function getConversationHistory() {
  return getChatHistory().map(({ role, content }) => ({ role, content }));
}

// Recupera o id da conversa atual.
// Se ainda nao existir uma conversa no localStorage, cria uma no Supabase
// e guarda o id para as proximas mensagens continuarem na mesma conversa.
async function getCurrentConversationId() {
  let conversationId = localStorage.getItem("currentConversationId");

  if (!conversationId) {
    const conversation = await createConversation("Nova conversa");
    conversationId = conversation.id;
    localStorage.setItem("currentConversationId", conversationId);
  }

  return conversationId;
}

// Carrega as mensagens salvas no Supabase para a conversa atual.
// Se a conversa estiver vazia, cria a mensagem inicial no localStorage e no banco.
async function loadConversationFromSupabase() {
  const conversationId = await getCurrentConversationId();
  const messages = await getMessages(conversationId);

  if (messages.length === 0) {
    const initialMessage = {
      role: "assistant",
      content:
        "Olá! Me diga sobre qual assunto você quer conversar e eu vou me adaptar ao contexto."
    };

    saveChatHistory([initialMessage]);
    await saveMessage(conversationId, initialMessage.role, initialMessage.content);
    return;
  }

  // O Supabase retorna colunas de banco. Aqui convertemos para o formato
  // que o chat ja sabe renderizar: role, content e attachment.
  const formattedMessages = messages.map((msg) => ({
    role: msg.role,
    content: msg.content,
    attachment: msg.attachment_name
      ? {
          name: msg.attachment_name,
          type: msg.attachment_type
        }
      : null
  }));

  saveChatHistory(formattedMessages);
}

// Escapa HTML para impedir que texto vire HTML executável.
function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

// Formata um markdown simples nas respostas.
function formatMarkdown(text) {
  let formatted = escapeHtml(text);

  // Bloco de código com ```
  formatted = formatted.replace(
    /```([\s\S]*?)```/g,
    '<pre class="code-block"><code>$1</code></pre>'
  );

  // Código inline com `
  formatted = formatted.replace(
    /`([^`]+)`/g,
    '<code class="inline-code">$1</code>'
  );

  // Negrito com **texto**
  formatted = formatted.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");

  // Itálico com *texto*
  formatted = formatted.replace(/\*(.*?)\*/g, "<em>$1</em>");

  // Quebras de linha
  formatted = formatted.replace(/\n/g, "<br>");

  return formatted;
}

// Define a letra do avatar.
function getAvatarLetter(role) {
  return role === "user" ? "U" : "IA";
}

// Copia texto da resposta da IA.
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

// Cria uma miniatura leve de imagem para exibir no chat.
async function createImageThumbnail(file) {
  // Lê a imagem como base64.
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Não foi possível ler a imagem."));
    reader.readAsDataURL(file);
  });

  // Redimensiona a imagem para não pesar no localStorage.
  return new Promise((resolve) => {
    const image = new Image();

    image.onload = () => {
      const maxSide = 160;
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

// Monta o objeto do anexo para mostrar no chat.
async function buildAttachment(file) {
  if (!file) return null;

  const attachment = {
    name: file.name,
    type: file.type || "application/octet-stream"
  };

  // Se for imagem, cria preview.
  if (attachment.type.startsWith("image/")) {
    try {
      attachment.previewUrl = await createImageThumbnail(file);
    } catch (error) {
      console.error("Erro ao gerar miniatura:", error);
    }
  }

  return attachment;
}

// Cria o card visual do arquivo/imagem enviado.
function createAttachmentElement(role, attachment) {
  const card = document.createElement("div");

  card.classList.add(
    "message-attachment",
    role === "user" ? "message-attachment-user" : "message-attachment-assistant"
  );

  const isImage = attachment?.type?.startsWith("image/");

  // Se for imagem e tiver preview, mostra miniatura.
  if (isImage && attachment.previewUrl) {
    const image = document.createElement("img");
    image.classList.add("message-attachment-thumb");
    image.src = attachment.previewUrl;
    image.alt = attachment.name || "Imagem enviada";
    card.appendChild(image);
  } else {
    // Se não for imagem, mostra ícone genérico.
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

// Cria visualmente uma mensagem no chat.
function createMessageElement(role, content = "", useTyping = false, attachment = null) {
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

  // Se tiver anexo, coloca o card do anexo antes da bolha.
  if (attachment) {
    messageBox.appendChild(createAttachmentElement(role, attachment));
  }

  // Só adiciona bolha se tiver conteúdo ou se for typing.
  if (useTyping || content || !attachment) {
    messageBox.appendChild(bubble);
  }

  // Botão copiar apenas para respostas da IA.
  if (role === "assistant" && !useTyping && content) {
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

// Renderiza todas as mensagens na tela.
function renderMessages() {
  const container = document.getElementById("chatMessages");
  if (!container) return;

  container.innerHTML = "";

  const history = getChatHistory();

  history.forEach((msg) => {
    const { wrapper } = createMessageElement(
      msg.role,
      msg.content || "",
      false,
      msg.attachment || null
    );

    container.appendChild(wrapper);
  });

  container.scrollTop = container.scrollHeight;
}

// Mostra "A IA está digitando..."
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

// Remove o indicador de digitação.
function removeTyping() {
  const typing = document.getElementById("typingIndicator");
  if (typing) typing.remove();
}

// Limpa a conversa.
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

// Volta para a tela inicial.
function goBack() {
  window.location.href = "index.html";
}

// Abre e fecha a sidebar.
function toggleSidebar() {
  document.body.classList.toggle("sidebar-collapsed");

  const isCollapsed = document.body.classList.contains("sidebar-collapsed");
  localStorage.setItem("sidebarState", isCollapsed ? "closed" : "open");
}

// Configura o textarea.
function setupTextarea() {
  const textarea = document.getElementById("messageInput");
  if (!textarea) return;

  // Ajusta a altura automaticamente.
  const autoResize = () => {
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  };

  textarea.addEventListener("input", autoResize);

  // Enter envia, Shift+Enter quebra linha.
  textarea.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSubmit(event);
    }
  });

  autoResize();
}

// Efeito de digitação para mensagens normais.
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

// Função chamada quando clica em enviar ou aperta Enter
// Função chamada quando o usuário clica no botão Enviar ou aperta Enter
async function handleSubmit(event) {
  // Impede qualquer comportamento padrão do navegador
  if (event) event.preventDefault();

  // Pega o campo de texto
  const input = document.getElementById("messageInput");

  // Pega o input de arquivo
  const fileInput = document.getElementById("fileInput");

  // Pega o arquivo selecionado, se existir
  const file = fileInput?.files[0];

  // Pega a IA escolhida: openai ou gemini
  const provider = getProvider();

  console.log("HANDLE SUBMIT CHAMADO");
  console.log("Arquivo selecionado:", file);

  // Se não tiver input ou provider, para a função
  if (!input || !provider) return;

  // Pega a mensagem digitada
  const message = input.value.trim();

  // Se não tiver mensagem nem arquivo, não envia nada
  if (!message && !file) return;

  // Pega o histórico antes de adicionar a mensagem atual
  const historyBeforeSubmit = getConversationHistory();

  // Cria o preview visual do arquivo, se houver
  const attachment = file ? await buildAttachment(file) : null;

  // Mostra a mensagem do usuário no chat
  addMessage(
    "user",
    message || `Arquivo enviado: ${file.name}`,
    attachment
  );

  // A mensagem aparece no chat imediatamente pelo localStorage.
  // Em seguida tentamos salvar no Supabase para manter historico persistente.
  // Se o Supabase falhar, o chat continua funcionando no navegador.
  let conversationId = null;

  try {
    conversationId = await getCurrentConversationId();

    await saveMessage(
      conversationId,
      "user",
      message || `Arquivo enviado: ${file.name}`,
      attachment
    );
  } catch (error) {
    console.error("Erro ao salvar mensagem do usuario no Supabase:", error);
  }

  // Atualiza a tela
  renderMessages();

  // Limpa o campo de texto
  input.value = "";
  input.style.height = "auto";

  // Mostra "A IA está digitando..."
  showTyping();

  try {
    let data;

    // Se tiver arquivo, usa uploadFile
    if (file) {
      console.log("ENVIANDO ARQUIVO PARA BACKEND");

      data = await uploadFile(
        provider,
        message || "Analise este arquivo.",
        historyBeforeSubmit,
        file
      );

      console.log("RESPOSTA DO UPLOAD:", data);
    } else {
      // Se não tiver arquivo, envia mensagem normal
      console.log("ENVIANDO TEXTO PARA BACKEND");

      data = await sendMessage(
        provider,
        message,
        [...historyBeforeSubmit, { role: "user", content: message }]
      );

      console.log("RESPOSTA DO CHAT:", data);
    }

    // Pega a resposta da IA
    const reply = data.reply || "Sem resposta da IA.";

    console.log("REPLY FINAL:", reply);
    console.log("VAI EXIBIR NO CHAT:", reply);

    // Remove o carregamento
    removeTyping();

    // Adiciona a resposta da IA no histórico
    addMessage("assistant", reply);

    // Salva tambem a resposta da IA na mesma conversa do Supabase.
    if (conversationId) {
      try {
        await saveMessage(conversationId, "assistant", reply);
      } catch (error) {
        console.error("Erro ao salvar resposta da IA no Supabase:", error);
      }
    }

    // Renderiza a resposta na tela
    renderMessages();

    // Limpa o arquivo selecionado
    if (fileInput) fileInput.value = "";

    // Limpa o preview do arquivo
    const filePreview = document.getElementById("filePreview");
    if (filePreview) filePreview.innerHTML = "";

  } catch (error) {
    // Remove carregamento
    removeTyping();

    // Mostra erro no chat
    addMessage(
      "assistant",
      error.message || "Desculpe, houve um erro ao conectar com o servidor."
    );

    // Atualiza a tela
    renderMessages();

    // Mostra erro técnico no console
    console.error("erro ao enviar a mensagem:", error);
  }
}

// Inicializa o chat quando a página carrega
async function initializeChat() {
  if (redirectToBackendOriginIfNeeded()) {
    return;
  }

  restoreTransferState();

  // Pega o provedor salvo no localStorage
  const provider = getProvider();

  // Pega o label onde aparece Gemini/OpenAI
  const providerLabel = document.getElementById("providerLabel");

  // Pega o botão de enviar
  const sendButton = document.getElementById("sendButton");

  // Pega o input de arquivo
  const fileInput = document.getElementById("fileInput");

  // Pega a área de preview do arquivo
  const filePreview = document.getElementById("filePreview");

  // Se não tiver provider, volta para a tela inicial
  if (!provider) {
    window.location.href = "index.html";
    return;
  }

  // Mostra o nome da IA escolhida
  if (providerLabel) {
    providerLabel.textContent = getProviderLabel(provider);
  }

  // Se não tiver histórico, cria a primeira mensagem da IA
  if (getChatHistory().length === 0) {
    saveChatHistory([
      {
        role: "assistant",
        content:
          "Olá! Me diga sobre qual assunto você quer conversar e eu vou me adaptar ao contexto."
      }
    ]);
  }

  // Mantém estado da sidebar
  const sidebarState = localStorage.getItem("sidebarState");

  if (sidebarState === "closed") {
    document.body.classList.add("sidebar-collapsed");
  }

  // Carrega mensagens salvas no Supabase e renderiza na tela
  try {
    await loadConversationFromSupabase();
  } catch (error) {
    console.error("Erro ao carregar conversa do Supabase:", error);
  }

  renderMessages();

  // Configura textarea
  setupTextarea();

  // Envia apenas pelo botão via JavaScript.
  // Como agora não usamos submit nativo, evita reload/abort do fetch.
  if (sendButton) {
    sendButton.addEventListener("click", handleSubmit);
  }

  // Preview do arquivo selecionado
  if (fileInput && filePreview) {
    fileInput.addEventListener("change", () => {
      const file = fileInput.files[0];

      // Limpa preview antigo
      filePreview.innerHTML = "";

      // Se não tiver arquivo, para
      if (!file) return;

      // Se for imagem, mostra miniatura
      if (file.type.startsWith("image/")) {
        const img = document.createElement("img");
        img.src = URL.createObjectURL(file);

        const span = document.createElement("span");
        span.textContent = file.name;

        filePreview.appendChild(img);
        filePreview.appendChild(span);
      } else {
        // Se for PDF/documento, mostra só o nome
        filePreview.innerHTML = `<span>${file.name}</span>`;
      }
    });
  }
}

// Expõe funções usadas no HTML.
window.clearChat = clearChat;
window.goBack = goBack;
window.toggleSidebar = toggleSidebar;
// Permite usar logout() direto no HTML
window.logout = logout;

// Inicia tudo quando o HTML carregar.
document.addEventListener("DOMContentLoaded", initializeChat);
