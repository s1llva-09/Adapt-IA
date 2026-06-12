import { protectPage, getSession } from "./auth.js";
import { fetchWithFallback } from "./api.js";

// Protege a página: redireciona para login se não estiver logado
protectPage();

// Lista de agentes disponíveis no sistema.
// Adicione aqui quando criar novos agentes.
const ALL_AGENTS = [
  { value: "financial_management", label: "Gestão Financeira" }
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
// INICIALIZAÇÃO
// ----------------------------------------------------------

checkAdmin().then(() => {
  setupCreateForm();
  loadUsers();
});
