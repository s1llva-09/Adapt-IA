console.log("CHAT.JS NOVO CARREGADO");
// Importa as funções que conversam com o backend.
import { extractMemory, sendMessage, uploadFile } from "./api.js";
import { protectPage, logout } from "./auth.js";
import {
  createConversation,
  getConversationById,
  getMessages,
  getMemories,
  saveMemory,
  saveMessage
} from "./database.js";

// Garante que apenas usuarios logados acessem o chat.
// Se nao houver sessao ativa no Supabase, auth.js redireciona para login.html.
protectPage();

// Mesmo identificador usado no main.js e no server.js.
// Ele diz que o usuário escolheu o agente de Gestão Financeira.
const FINANCIAL_ASSISTANT_TYPE = "financial_management";

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
        // Leva o agente junto no redirect entre Live Server e backend local.
        assistantType: getAssistantType(),
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

  if (transferState.assistantType && !localStorage.getItem("assistantType")) {
    // Restaura o agente salvo antes do redirecionamento.
    localStorage.setItem("assistantType", transferState.assistantType);
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

// Retorna o agente empresarial escolhido.
function getAssistantType() {
  // Valor salvo ao clicar no card de Gestão Financeira.
  return localStorage.getItem("assistantType");
}

// Converte o valor técnico em nome bonito para exibir na tela.
function getProviderLabel(value) {
  if (value === "openai") return "OpenAI";
  if (value === "gemini") return "Gemini";
  return "-";
}

function getAgentLabel(value) {
  // Nome amigável mostrado na sidebar.
  if (value === FINANCIAL_ASSISTANT_TYPE) return "Gestão Financeira";
  return "Assistente Geral";
}

function getInitialAssistantMessage(value) {
  // Mensagem inicial muda conforme o agente escolhido.
  if (value === FINANCIAL_ASSISTANT_TYPE) {
    return "Olá! Sou seu agente de Gestão Financeira. Posso ajudar com fluxo de caixa, contas a pagar, contas a receber, custos, precificação e relatórios.";
  }

  return "Olá! Me diga sobre qual assunto você quer conversar e eu vou me adaptar ao contexto.";
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
      chart: message.chart || null,
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

// Adiciona uma nova mensagem ao histórico
function addMessage(role, content, attachment = null, chart = null) {
  const history = getChatHistory();

  history.push({
    role,
    content,
    attachment,
    chart
  });

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

  // O localStorage pode guardar um id antigo de conversa que ja foi apagada
  // no Supabase. Se usarmos esse id, o insert em messages quebra por FK.
  // Por isso validamos se a conversa ainda existe antes de reutilizar.
  if (conversationId) {
    const existingConversation = await getConversationById(conversationId);

    if (existingConversation) {
      return conversationId;
    }

    localStorage.removeItem("currentConversationId");
  }

  const conversation = await createConversation(
    getAgentLabel(getAssistantType()),
    getAssistantType()
  );

  conversationId = conversation.id;
  localStorage.setItem("currentConversationId", conversationId);

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
      content: getInitialAssistantMessage(getAssistantType())
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

// ==========================================================
// CRIA UM GRÁFICO DENTRO DA MENSAGEM
// ==========================================================

function createLegacyChartElement(chart) {
  // Cria a caixa do gráfico
  const chartBox = document.createElement("div");
  chartBox.classList.add("message-chart");

  // Cria o título do gráfico
  const title = document.createElement("h4");
  title.textContent = chart.title || "Gráfico";
  chartBox.appendChild(title);

  // Cria o canvas onde o Chart.js vai desenhar
  const canvas = document.createElement("canvas");
  chartBox.appendChild(canvas);

  // O setTimeout garante que o canvas já esteja na tela antes de renderizar
  setTimeout(() => {
    const ChartConstructor = window.Chart;

    if (!ChartConstructor) {
      console.error("Chart.js não foi carregado.");
      return;
    }

    new ChartConstructor(canvas, {
      type: chart.type || "bar",
      data: {
        labels: chart.labels || [],
        datasets: [
          {
            label: chart.title || "Valores",
            data: chart.values || []
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: false
          }
        },
        scales: {
          y: {
            beginAtZero: true
          }
        }
      }
    });
  }, 0);

  return chartBox;
}

// ==========================================================
// CRIA UM GRAFICO DENTRO DA MENSAGEM COM SUPORTE A PIZZA
// ==========================================================

function createChartElement(chart) {
  // Cria a caixa do grafico.
  const chartBox = document.createElement("div");
  chartBox.classList.add("message-chart");

  // Grafico de pizza/doughnut precisa de tamanho e legenda proprios.
  if (chart.type === "pie" || chart.type === "doughnut") {
    chartBox.classList.add("message-chart-pie");
  }

  // Titulo exibido acima do canvas.
  const title = document.createElement("h4");
  title.textContent = chart.title || "Gráfico";
  chartBox.appendChild(title);

  // Wrapper com altura fixa para o Chart.js calcular o tamanho corretamente.
  const canvasWrapper = document.createElement("div");
  canvasWrapper.classList.add("chart-canvas-wrapper");

  const canvas = document.createElement("canvas");
  canvasWrapper.appendChild(canvas);
  chartBox.appendChild(canvasWrapper);

  // Renderiza depois que o elemento entra na tela.
  setTimeout(() => {
    const ChartConstructor = window.Chart;

    if (!ChartConstructor) {
      console.error("Chart.js não foi carregado.");
      return;
    }

    const isPieChart = chart.type === "pie" || chart.type === "doughnut";

    const config = {
      type: chart.type || "bar",
      data: {
        labels: chart.labels || [],
        datasets: [
          {
            label: chart.title || "Valores",
            data: chart.values || []
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: isPieChart,
            position: "bottom",
            labels: {
              color: "#e5e7eb",
              boxWidth: 14,
              padding: 14
            }
          },
          tooltip: {
            callbacks: {
              label: function (context) {
                const label = context.label || "";
                const value = context.raw || 0;
                const total = context.dataset.data.reduce(
                  (sum, item) => sum + Number(item || 0),
                  0
                );
                const percent = total
                  ? ((value / total) * 100).toFixed(1)
                  : 0;

                if (isPieChart) {
                  return `${label}: ${value.toLocaleString("pt-BR")} (${percent}%)`;
                }

                return `${label}: ${value.toLocaleString("pt-BR")}`;
              }
            }
          }
        }
      }
    };

    // Grafico de barras precisa de eixo x/y. Pizza nao usa escalas.
    if (!isPieChart) {
      config.options.scales = {
        x: {
          ticks: {
            color: "#cbd5e1"
          },
          grid: {
            color: "rgba(148, 163, 184, 0.12)"
          }
        },
        y: {
          beginAtZero: true,
          ticks: {
            color: "#cbd5e1"
          },
          grid: {
            color: "rgba(148, 163, 184, 0.12)"
          }
        }
      };
    }

    new ChartConstructor(canvas, config);
  }, 0);

  return chartBox;
}

// Cria visualmente uma mensagem no chat.
function createMessageElement(
  role,
  content = "",
  useTyping = false,
  attachment = null,
  chart = null
) {
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

  // Se tiver gráfico e for resposta da IA, mostra o gráfico abaixo do texto
  if (chart && role === "assistant") {
    messageBox.appendChild(createChartElement(chart));
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
      msg.attachment || null,
      msg.chart || null
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
  // Limpar conversa nao apaga memorias persistentes.
  // Apenas remove o id da conversa atual para a proxima mensagem criar
  // uma nova conversa no Supabase.
  localStorage.removeItem("currentConversationId");

  const initialHistory = [
    {
      role: "assistant",
      content: getInitialAssistantMessage(getAssistantType())
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

// ==========================================================
// IDENTIFICA O TIPO DO ARQUIVO
// ==========================================================
function getFileKind(file) {
  // Se não tiver arquivo, retorna null
  if (!file) return null;

  // Pega nome e tipo do arquivo
  const name = file.name.toLowerCase();
  const type = file.type || "";

  // Imagem
  if (type.startsWith("image/")) {
    return "image";
  }

  // PDF
  if (type === "application/pdf" || name.endsWith(".pdf")) {
    return "pdf";
  }

  // Excel ou CSV
  if (
    name.endsWith(".xlsx") ||
    name.endsWith(".xls") ||
    name.endsWith(".csv")
  ) {
    return "excel";
  }

  // Word
  if (name.endsWith(".docx")) {
    return "docx";
  }

  // Texto/código
  return "text";
}

// ==========================================================
// MOSTRA STATUS DO UPLOAD
// ==========================================================
function showUploadStatus(file) {
  const status = document.getElementById("uploadStatus");

  if (!status) return;

  const kind = getFileKind(file);

  let message = "Analisando arquivo...";

  if (kind === "image") {
    message = "Analisando imagem e lendo texto visível...";
  }

  if (kind === "pdf") {
    message = "Lendo PDF e analisando conteúdo...";
  }

  if (kind === "excel") {
    message = "Lendo planilha Excel e organizando dados...";
  }

  if (kind === "docx") {
    message = "Lendo documento Word...";
  }

  if (kind === "text") {
    message = "Lendo arquivo de texto/código...";
  }

  status.textContent = message;
  status.classList.remove("hidden");
}

// ==========================================================
// ESCONDE STATUS DO UPLOAD
// ==========================================================
function hideUploadStatus() {
  const status = document.getElementById("uploadStatus");

  if (!status) return;

  status.textContent = "";
  status.classList.add("hidden");
}

// ==========================================================
// LIMPA O ARQUIVO SELECIONADO
// ==========================================================
function clearSelectedFile() {
  const fileInput = document.getElementById("fileInput");
  const filePreview = document.getElementById("filePreview");
  const attachmentArea = document.getElementById("attachmentArea");

  if (fileInput) fileInput.value = "";

  if (filePreview) filePreview.innerHTML = "";

  if (attachmentArea) {
    attachmentArea.classList.add("hidden");
  }
}

// ==========================================================
// MOSTRA PREVIEW DO ARQUIVO SELECIONADO
// ==========================================================
function renderSelectedFilePreview(file) {
  const filePreview = document.getElementById("filePreview");
  const attachmentArea = document.getElementById("attachmentArea");

  if (!filePreview || !attachmentArea) return;

  filePreview.innerHTML = "";

  if (!file) {
    attachmentArea.classList.add("hidden");
    return;
  }

  attachmentArea.classList.remove("hidden");

  if (file.type.startsWith("image/")) {
    const img = document.createElement("img");
    img.src = URL.createObjectURL(file);

    const span = document.createElement("span");
    span.textContent = file.name;

    filePreview.appendChild(img);
    filePreview.appendChild(span);
    return;
  }

  const span = document.createElement("span");
  span.textContent = `📎 ${file.name}`;
  filePreview.appendChild(span);
}

// ==========================================================
// MENSAGENS DE ERRO MAIS BONITAS
// ==========================================================
function getFriendlyErrorMessage(error) {
  const message = String(error?.message || error || "");

  if (
    message.includes("429") ||
    message.toLowerCase().includes("quota") ||
    message.toLowerCase().includes("limite")
  ) {
    return "O limite temporário da IA foi atingido. Aguarde alguns segundos e tente novamente.";
  }

  if (
    message.toLowerCase().includes("failed to fetch") ||
    message.toLowerCase().includes("conectar") ||
    message.toLowerCase().includes("backend")
  ) {
    return "Não consegui conectar ao servidor. Verifique se o backend está rodando e tente novamente.";
  }

  if (
    message.toLowerCase().includes("file too large") ||
    message.toLowerCase().includes("too large") ||
    message.toLowerCase().includes("limit")
  ) {
    return "Esse arquivo é muito grande. Envie um arquivo menor ou divida o conteúdo.";
  }

  if (
    message.toLowerCase().includes("unsupported") ||
    message.toLowerCase().includes("inválido") ||
    message.toLowerCase().includes("invalid")
  ) {
    return "Esse tipo de arquivo não é compatível no momento.";
  }

  return message || "Ocorreu um erro ao processar sua solicitação.";
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

  // Pega o agente escolhido: por enquanto, financial_management.
  const assistantType = getAssistantType();

  console.log("HANDLE SUBMIT CHAMADO");
  console.log("Arquivo selecionado:", file);

  // Se faltar input, provider ou agente, para a função.
  // Isso evita mandar mensagem sem contexto de qual agente deve responder.
  if (!input || !provider || !assistantType) return;

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

  // Se tiver arquivo, mostra um status específico
  if (file) {
    showUploadStatus(file);
  }

  try {
    let data;

    // Busca as memorias persistentes do agente atual antes de chamar a IA.
    // Essas memorias vêm da tabela "memories" e não somem ao limpar conversa.
    const memories = await getMemories(assistantType);

    // Se tiver arquivo, usa uploadFile
    if (file) {
      console.log("ENVIANDO ARQUIVO PARA BACKEND");

      data = await uploadFile(
        provider,
        // Envia o agente para o backend analisar o arquivo no papel correto.
        assistantType,
        message || "Analise este arquivo.",
        historyBeforeSubmit,
        file,
        memories
      );

      console.log("RESPOSTA DO UPLOAD:", data);
    } else {
      // Se não tiver arquivo, envia mensagem normal
      console.log("ENVIANDO TEXTO PARA BACKEND");

      data = await sendMessage(
        provider,
        // Envia o agente para o backend montar o prompt financeiro.
        assistantType,
        message,
        [...historyBeforeSubmit, { role: "user", content: message }],
        memories
      );

      console.log("RESPOSTA DO CHAT:", data);
    }

    // Pega a resposta da IA
    const reply = data.reply || "Sem resposta da IA.";
    
    console.log("VAI EXIBIR NO CHAT:", reply);

    // Remove o carregamento
    removeTyping();

    hideUploadStatus();

    // Adiciona a resposta da IA no histórico
    addMessage("assistant", reply, null, data.chart || null);

    // Salva tambem a resposta da IA na mesma conversa do Supabase.
    if (conversationId) {
      try {
        await saveMessage(conversationId, "assistant", reply);
      } catch (error) {
        console.error("Erro ao salvar resposta da IA no Supabase:", error);
      }
    }

    // Depois que a IA respondeu, tentamos transformar a interação em memória.
    // Isso não salva qualquer mensagem: o backend decide se existe um aprendizado
    // realmente útil e persistente para o agente atual.
    if (conversationId) {
      try {
        // Define qual texto do usuário será usado para a extração de memória.
        // Se foi mensagem normal, usa a mensagem digitada.
        // Se foi arquivo sem texto, registra que um arquivo foi enviado.
        const userMessageForMemory =
          message || (file ? `Arquivo enviado: ${file.name}` : "");

        // Pede ao backend para avaliar se esta troca deve virar memória.
        // O backend pode retornar uma string curta ou null.
        const memory = await extractMemory(
          provider,
          assistantType,
          userMessageForMemory,
          reply,
          historyBeforeSubmit
        );

        if (memory) {
          // Busca as memórias atuais do mesmo agente.
          // A comparação é feita por agente para não misturar assuntos
          // de Gestão Financeira com futuros agentes, como DP ou Comercial.
          const existingMemories = await getMemories(assistantType);

          // Normaliza textos antes de comparar.
          // Isso reduz diferença causada por maiúsculas, minúsculas
          // ou espaços repetidos.
          const normalizeMemory = (text) =>
            text
              .toLowerCase()
              .replace(/\s+/g, " ")
              .trim();

          const normalizedNewMemory = normalizeMemory(memory);

          // Verifica se já existe uma memória igual ou muito parecida.
          // Esta é uma comparação simples e barata, sem gastar outra chamada de IA.
          // Exemplo:
          // nova: "o usuário tem uma loja de roupas"
          // antiga: "o usuário informou que sua empresa é uma loja de roupas"
          const alreadyExists = existingMemories.some((item) => {
            const normalizedExistingMemory = normalizeMemory(item.content);

            return (
              normalizedExistingMemory.includes(normalizedNewMemory) ||
              normalizedNewMemory.includes(normalizedExistingMemory)
            );
          });

          // Só salva no Supabase se ainda não existir algo parecido.
          if (!alreadyExists) {
            await saveMemory(assistantType, memory, conversationId);
            console.log("Memória salva:", memory);
          } else {
            console.log("Memória ignorada por duplicidade:", memory);
          }
        }
      } catch (error) {
        // A memória é uma melhoria do chat, não uma parte essencial da resposta.
        // Se falhar por cota, rede ou Supabase, a conversa continua normalmente.
        console.error("Erro ao extrair/salvar memória:", error);
      }
    }

    // Renderiza a resposta na tela
    renderMessages();

    // Limpa o arquivo selecionado
    clearSelectedFile();

  } catch (error) {
    // Remove carregamento
    removeTyping();

    hideUploadStatus();

    // Mostra erro no chat
    addMessage(
      "assistant",
      getFriendlyErrorMessage(error)
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

  // Pega o agente salvo no localStorage.
  const assistantType = getAssistantType();

  // Pega os labels da sidebar: motor da IA e agente empresarial.
  const providerLabel = document.getElementById("providerLabel");
  const agentLabel = document.getElementById("agentLabel");

  // Pega o botão de enviar
  const sendButton = document.getElementById("sendButton");

  // Pega o input de arquivo
  const fileInput = document.getElementById("fileInput");

  // Pega a área de preview do arquivo
  const filePreview = document.getElementById("filePreview");

  const chatForm = document.getElementById("chatForm");
  const fileMenuButton = document.getElementById("fileMenuButton");
  const fileTypeMenu = document.getElementById("fileTypeMenu");
  const clearAttachmentButton = document.getElementById("clearAttachmentButton");

  // Se não tiver provider ou agente, volta para a tela inicial.
  // Assim o usuário sempre entra no chat com um agente escolhido.
  if (!provider || !assistantType) {
    window.location.href = "index.html";
    return;
  }

  // Mostra o nome da IA escolhida
  if (providerLabel) {
    providerLabel.textContent = getProviderLabel(provider);
  }

  if (agentLabel) {
    // Mostra "Gestão Financeira" na lateral.
    agentLabel.textContent = getAgentLabel(assistantType);
  }

  // Se não tiver histórico, cria a primeira mensagem da IA
  if (getChatHistory().length === 0) {
    saveChatHistory([
      {
        role: "assistant",
        content: getInitialAssistantMessage(assistantType)
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

  // ==========================================================
  // PREVIEW DO ARQUIVO SELECIONADO
  // ==========================================================
  if (fileInput) {
    fileInput.addEventListener("change", () => {
      const file = fileInput.files[0];

      renderSelectedFilePreview(file);
    });
  }

  // ==========================================================
  // BOTÃO REMOVER ARQUIVO
  // ==========================================================
  if (clearAttachmentButton) {
    clearAttachmentButton.addEventListener("click", () => {
      clearSelectedFile();
    });
  }

  // ==========================================================
  // MENU DO CLIPE
  // ==========================================================
  if (fileMenuButton && fileTypeMenu && fileInput) {
    // Abre/fecha o menu ao clicar no clipe
    fileMenuButton.addEventListener("click", () => {
      fileTypeMenu.classList.toggle("hidden");
    });

    // Cada botão do menu muda o accept do input
    fileTypeMenu.querySelectorAll("button[data-accept]").forEach((button) => {
      button.addEventListener("click", () => {
        const accept = button.dataset.accept;

        fileInput.setAttribute("accept", accept);

        fileTypeMenu.classList.add("hidden");

        fileInput.click();
      });
    });

    // Fecha menu se clicar fora
    document.addEventListener("click", (event) => {
      const clickedMenu = fileTypeMenu.contains(event.target);
      const clickedButton = fileMenuButton.contains(event.target);

      if (!clickedMenu && !clickedButton) {
        fileTypeMenu.classList.add("hidden");
      }
    });
  }

  // ==========================================================
  // DRAG AND DROP DE ARQUIVOS
  // ==========================================================
  if (chatForm && fileInput) {
    chatForm.addEventListener("dragover", (event) => {
      event.preventDefault();

      chatForm.classList.add("drag-over");
    });

    chatForm.addEventListener("dragleave", () => {
      chatForm.classList.remove("drag-over");
    });

    chatForm.addEventListener("drop", (event) => {
      event.preventDefault();

      chatForm.classList.remove("drag-over");

      const droppedFile = event.dataTransfer.files[0];

      if (!droppedFile) return;

      const dataTransfer = new DataTransfer();

      dataTransfer.items.add(droppedFile);

      fileInput.files = dataTransfer.files;

      fileInput.dispatchEvent(new Event("change"));
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
