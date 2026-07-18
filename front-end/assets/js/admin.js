import { protectPage, getSession } from "./auth.js";
import { fetchWithFallback } from "./api.js";

// Protege a página: redireciona para login se não estiver logado
protectPage();

// Lista de agentes disponíveis no sistema.
const ALL_AGENTS = [
  { value: "financial_management", label: "Gestão Financeira" },
  { value: "human_resources",      label: "Recursos Humanos" },
  { value: "customer_service",     label: "Atendimento ao Cliente" },
  { value: "marketing_digital",    label: "Marketing Digital" },
  { value: "legal",                label: "Jurídico" }
];

// Estado do modal de edição de agentes
let modalUserId = null;
let modalUserEmail = "";

// ----------------------------------------------------------
// MODAL DE CONFIRMAÇÃO GENÉRICO
// ----------------------------------------------------------
// Retorna uma Promise<boolean>: true se o usuário confirmou, false se cancelou.
function showConfirmModal(title = "Confirmar", message = "Tem certeza?") {
  return new Promise((resolve) => {
    const modal   = document.getElementById("confirmModal");
    const titleEl = document.getElementById("confirmModalTitle");
    const msgEl   = document.getElementById("confirmModalMsg");
    const okBtn   = document.getElementById("confirmModalOkBtn");
    const cancelBtn = document.getElementById("confirmModalCancelBtn");

    titleEl.textContent = title;
    msgEl.textContent   = message;
    modal.classList.remove("hidden");

    const cleanup = () => modal.classList.add("hidden");

    const onOk = () => { cleanup(); okBtn.removeEventListener("click", onOk); cancelBtn.removeEventListener("click", onCancel); resolve(true); };
    const onCancel = () => { cleanup(); okBtn.removeEventListener("click", onOk); cancelBtn.removeEventListener("click", onCancel); resolve(false); };

    okBtn.addEventListener("click", onOk);
    cancelBtn.addEventListener("click", onCancel);
  });
}

// ----------------------------------------------------------
// AUTENTICAÇÃO
// ----------------------------------------------------------

async function getAuthToken() {
  const session = await getSession();
  return session?.access_token || null;
}

// Verifica se o usuário logado tem role 'admin'.
// Se não tiver, bloqueia o acesso e volta ao chat.
async function checkAdmin() {
  const token = await getAuthToken();
  if (!token) { window.location.href = "login.html"; return; }

  try {
    const res = await fetchWithFallback("/profile", {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    if (data.profile?.role !== "admin") {
      alert("Acesso negado. Apenas administradores.");
      window.location.href = "chat.html";
    }
  } catch (e) {
    console.error("Erro ao verificar perfil:", e);
    window.location.href = "chat.html";
  }
}

// ----------------------------------------------------------
// LISTAR USUÁRIOS
// ----------------------------------------------------------

async function loadUsers() {
  const token = await getAuthToken();
  const tbody = document.getElementById("userTableBody");
  const wrapper = document.getElementById("userTableWrapper");
  const loading = document.getElementById("loadingUsers");

  loading.classList.remove("hidden");
  wrapper.classList.add("hidden");
  tbody.innerHTML = "";

  try {
    const res = await fetchWithFallback("/admin/users", {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    const users = data.users || [];

    loading.classList.add("hidden");
    wrapper.classList.remove("hidden");

    // Atualiza badge de contagem
    const countEl = document.getElementById("userCount");
    if (countEl) { countEl.textContent = users.length; countEl.classList.remove("hidden"); }

    if (users.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="table-empty">Nenhum usuário encontrado.</td></tr>`;
      return;
    }

    users.forEach((user) => {
      const agentLabels = (user.allowed_agents || [])
        .map((a) => ALL_AGENTS.find((ag) => ag.value === a)?.label || a)
        .join(", ") || "Todos";

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td class="td-email">${user.email}</td>
        <td>
          <select class="role-select" data-id="${user.id}">
            <option value="user" ${user.role === "user" ? "selected" : ""}>Usuário</option>
            <option value="admin" ${user.role === "admin" ? "selected" : ""}>Admin</option>
          </select>
        </td>
        <td>
          <span class="agent-label-text">${agentLabels}</span>
          <button class="edit-agents-btn" data-id="${user.id}" data-email="${user.email}" data-agents='${JSON.stringify(user.allowed_agents || [])}'>Editar</button>
        </td>
        <td>${new Date(user.created_at).toLocaleDateString("pt-BR")}</td>
        <td class="td-actions">
          <button class="save-btn action-btn" data-id="${user.id}" title="Salvar alterações">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          </button>
          <button class="delete-btn action-btn danger-btn" data-id="${user.id}" title="Apagar usuário">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
          </button>
        </td>
      `;
      tbody.appendChild(tr);
    });

    // Salvar alterações de role
    tbody.querySelectorAll(".save-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const userId = btn.dataset.id;
        const roleSelect = tbody.querySelector(`.role-select[data-id="${userId}"]`);
        btn.disabled = true;
        await updateUser(userId, { role: roleSelect.value });
        btn.disabled = false;
      });
    });

    // Apagar usuário
    tbody.querySelectorAll(".delete-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const confirmed = await showConfirmModal(
          "Apagar usuário",
          "Tem certeza que deseja apagar este usuário permanentemente? Esta ação não pode ser desfeita."
        );
        if (!confirmed) return;
        btn.disabled = true;
        await deleteUser(btn.dataset.id);
        loadUsers();
      });
    });

    // Abrir modal de edição de agentes
    tbody.querySelectorAll(".edit-agents-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        openAgentsModal(
          btn.dataset.id,
          btn.dataset.email,
          JSON.parse(btn.dataset.agents)
        );
      });
    });

  } catch (err) {
    loading.textContent = "Erro ao carregar usuários.";
    console.error(err);
  }
}

// ----------------------------------------------------------
// ATUALIZAR USUÁRIO
// ----------------------------------------------------------

async function updateUser(userId, updates) {
  const token = await getAuthToken();
  try {
    const res = await fetchWithFallback(`/admin/users/${userId}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(updates)
    });
    const data = await res.json();
    if (data.error) alert(`Erro: ${data.error}`);
  } catch (err) {
    alert("Erro ao atualizar usuário.");
    console.error(err);
  }
}

// ----------------------------------------------------------
// DELETAR USUÁRIO
// ----------------------------------------------------------

async function deleteUser(userId) {
  const token = await getAuthToken();
  try {
    const res = await fetchWithFallback(`/admin/users/${userId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    if (data.error) alert(`Erro: ${data.error}`);
  } catch (err) {
    alert("Erro ao apagar usuário.");
    console.error(err);
  }
}

// ----------------------------------------------------------
// MODAL DE AGENTES
// ----------------------------------------------------------

function openAgentsModal(userId, userEmail, currentAgents) {
  modalUserId = userId;
  modalUserEmail = userEmail;

  document.getElementById("modalUserEmail").textContent = userEmail;
  document.getElementById("modalError").classList.add("hidden");

  const container = document.getElementById("modalAgentCheckboxes");
  container.innerHTML = "";

  ALL_AGENTS.forEach((agent) => {
    const label = document.createElement("label");
    label.innerHTML = `
      <input type="checkbox" value="${agent.value}" ${currentAgents.includes(agent.value) ? "checked" : ""}>
      ${agent.label}
    `;
    container.appendChild(label);
  });

  document.getElementById("agentsModal").classList.remove("hidden");
}

function closeAgentsModal() {
  document.getElementById("agentsModal").classList.add("hidden");
  modalUserId = null;
}

document.getElementById("modalCancelBtn").addEventListener("click", closeAgentsModal);

document.getElementById("modalSaveBtn").addEventListener("click", async () => {
  if (!modalUserId) return;

  const allowed_agents = Array.from(
    document.querySelectorAll("#modalAgentCheckboxes input:checked")
  ).map((cb) => cb.value);

  const btn = document.getElementById("modalSaveBtn");
  const btnSpan = btn.querySelector("span");
  btnSpan.textContent = "Salvando...";
  btn.disabled = true;

  await updateUser(modalUserId, { allowed_agents });

  btnSpan.textContent = "Salvar";
  btn.disabled = false;
  closeAgentsModal();
  loadUsers();
});

// ----------------------------------------------------------
// FORMULÁRIO — CRIAR USUÁRIO
// ----------------------------------------------------------

// Preenche os checkboxes de agentes do formulário de criação
function setupCreateForm() {
  const container = document.getElementById("agentCheckboxesCreate");
  ALL_AGENTS.forEach((agent) => {
    const label = document.createElement("label");
    label.innerHTML = `<input type="checkbox" value="${agent.value}"> ${agent.label}`;
    container.appendChild(label);
  });
}

document.getElementById("createUserForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById("createUserError");
  errorEl.classList.add("hidden");

  const email = document.getElementById("newEmail").value.trim();
  const password = document.getElementById("newPassword").value;
  const role = document.getElementById("newRole").value;
  const allowed_agents = Array.from(
    document.querySelectorAll("#agentCheckboxesCreate input:checked")
  ).map((cb) => cb.value);

  const token = await getAuthToken();
  const submitBtn = e.target.querySelector("button[type=submit]");
  const submitSpan = submitBtn.querySelector("span");
  submitSpan.textContent = "Criando...";
  submitBtn.disabled = true;

  try {
    const res = await fetchWithFallback("/admin/users", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ email, password, role, allowed_agents })
    });
    const data = await res.json();
    if (data.error) {
      errorEl.textContent = data.error;
      errorEl.classList.remove("hidden");
    } else {
      e.target.reset();
      loadUsers();
    }
  } catch (err) {
    errorEl.textContent = "Erro ao criar usuário.";
    errorEl.classList.remove("hidden");
    console.error(err);
  } finally {
    submitSpan.textContent = "Criar Usuário";
    submitBtn.disabled = false;
  }
});

// ----------------------------------------------------------
// BOTÃO ATUALIZAR
// ----------------------------------------------------------

document.getElementById("refreshUsersBtn").addEventListener("click", loadUsers);

// ----------------------------------------------------------
// ANALYTICS
// ----------------------------------------------------------

const AGENT_LABELS = {
  financial_management: "Gest. Financeira",
  human_resources:      "Recursos Humanos",
  customer_service:     "Atendimento",
  marketing_digital:    "Marketing",
  legal:                "Jurídico",
  general:              "Geral"
};

async function loadStats() {
  const token = await getAuthToken();
  const grid = document.getElementById("statsGrid");
  const agentsEl = document.getElementById("statsAgents");
  const dailyEl = document.getElementById("statsDaily");
  const barsEl = document.getElementById("statsBars");

  try {
    const res = await fetchWithFallback("/admin/stats", {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();

    grid.innerHTML = `
      <div class="stat-card"><span class="stat-value">${data.totalUsers ?? "-"}</span><span class="stat-label">Usuários</span></div>
      <div class="stat-card"><span class="stat-value">${data.totalConversations ?? "-"}</span><span class="stat-label">Conversas</span></div>
      <div class="stat-card"><span class="stat-value">${data.totalMessages ?? "-"}</span><span class="stat-label">Mensagens</span></div>
    `;

    // Agentes mais usados
    if (data.agentCount && Object.keys(data.agentCount).length) {
      const sorted = Object.entries(data.agentCount).sort((a, b) => b[1] - a[1]);
      agentsEl.innerHTML = `<p class="stats-section-title">Conversas por agente</p>` +
        sorted.map(([k, v]) => `<div class="agent-stat-row"><span>${AGENT_LABELS[k] || k}</span><span class="agent-stat-count">${v}</span></div>`).join("");
      agentsEl.classList.remove("hidden");
    }

    // Mensagens por dia
    if (data.dailyMessages?.length) {
      const max = Math.max(...data.dailyMessages.map(d => d.count), 1);
      barsEl.innerHTML = data.dailyMessages.map(d => {
        const pct = Math.round((d.count / max) * 100);
        const label = new Date(d.date + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
        return `<div class="stats-bar-col">
          <span class="stats-bar-value">${d.count}</span>
          <div class="stats-bar-track"><div class="stats-bar-fill" style="height:${pct}%"></div></div>
          <span class="stats-bar-label">${label}</span>
        </div>`;
      }).join("");
      dailyEl.classList.remove("hidden");
    }

  } catch (err) {
    grid.innerHTML = `<p class="admin-loading">Erro ao carregar estatísticas.</p>`;
    console.error(err);
  }
}

// ----------------------------------------------------------
// EDITOR DE SYSTEM PROMPTS
// ----------------------------------------------------------

async function loadPrompts() {
  const token = await getAuthToken();
  const select = document.getElementById("promptAgentSelect");
  const textarea = document.getElementById("promptTextarea");

  // Preenche o select com os agentes
  select.innerHTML = ALL_AGENTS.map(a => `<option value="${a.value}">${a.label}</option>`).join("");

  let customPrompts = {};

  try {
    const res = await fetchWithFallback("/admin/prompts", {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    customPrompts = data.prompts || {};
  } catch { /* continua com prompts vazios */ }

  const updateTextarea = () => {
    const agent = select.value;
    textarea.value = customPrompts[agent] || "";
    textarea.placeholder = "Deixe vazio para usar o prompt padrão do sistema...";
  };

  select.addEventListener("change", updateTextarea);
  updateTextarea();

  document.getElementById("savePromptBtn").addEventListener("click", async () => {
    const agent = select.value;
    const prompt = textarea.value;
    const msgEl = document.getElementById("promptMsg");
    const btn = document.getElementById("savePromptBtn");
    btn.disabled = true;

    try {
      const tok = await getAuthToken();
      const res = await fetchWithFallback(`/admin/prompts/${agent}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
        body: JSON.stringify({ prompt })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      customPrompts[agent] = prompt.trim() || undefined;
      msgEl.textContent = "Prompt salvo com sucesso!";
      msgEl.className = "settings-msg is-success";
      msgEl.classList.remove("hidden");
      setTimeout(() => msgEl.classList.add("hidden"), 3000);
    } catch (err) {
      msgEl.textContent = `Erro: ${err.message}`;
      msgEl.className = "settings-msg is-error";
      msgEl.classList.remove("hidden");
    } finally {
      btn.disabled = false;
    }
  });
}

// ----------------------------------------------------------
// INICIALIZAÇÃO
// ----------------------------------------------------------

checkAdmin().then(() => {
  setupCreateForm();
  loadUsers();
  loadStats();
  loadPrompts();
});
