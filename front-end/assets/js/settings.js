import { protectPage, getUser, getSession, updatePassword, logout } from "./auth.js";
import { fetchWithFallback } from "./api.js";
import { getAllMemories, deleteMemory } from "./database.js";

protectPage();

// ----------------------------------------------------------
// PERFIL
// ----------------------------------------------------------

async function loadProfile() {
  const user = await getUser();
  if (!user) return;

  const avatarEl   = document.getElementById("profileAvatar");
  const emailEl    = document.getElementById("profileEmail");
  const roleEl     = document.getElementById("profileRole");
  const sinceEl    = document.getElementById("profileSince");

  // Iniciais para o avatar
  const initials = (user.email || "?")[0].toUpperCase();
  avatarEl.textContent = initials;
  emailEl.textContent  = user.email;

  // Data de cadastro
  if (user.created_at) {
    sinceEl.textContent = "Membro desde " + new Date(user.created_at).toLocaleDateString("pt-BR", {
      day: "2-digit", month: "long", year: "numeric"
    });
  }

  // Role via /profile
  try {
    const session = await getSession();
    if (!session) return;
    const res  = await fetchWithFallback("/profile", {
      method: "GET",
      headers: { Authorization: `Bearer ${session.access_token}` }
    });
    const data = await res.json();
    const role = data.profile?.role;
    if (role === "admin") {
      roleEl.textContent = "Administrador";
      roleEl.classList.add("is-admin");
    } else {
      roleEl.textContent = "Usuário";
    }
  } catch {
    roleEl.textContent = "Usuário";
  }
}

// ----------------------------------------------------------
// ALTERAR SENHA
// ----------------------------------------------------------

document.querySelectorAll(".toggle-password").forEach((btn) => {
  btn.addEventListener("click", () => {
    const input = document.getElementById(btn.dataset.target);
    if (!input) return;
    const isShowing = input.type === "text";
    input.type = isShowing ? "password" : "text";
    btn.classList.toggle("is-visible", !isShowing);
    btn.setAttribute("aria-label", isShowing ? "Mostrar senha" : "Ocultar senha");
  });
});

document.getElementById("passwordForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  const msgEl    = document.getElementById("passwordMsg");
  const newPw    = document.getElementById("newPassword").value;
  const confirmPw = document.getElementById("confirmPassword").value;
  const btn      = e.target.querySelector("button[type=submit]");
  const btnSpan  = btn.querySelector("span");

  msgEl.className = "settings-msg hidden";
  msgEl.textContent = "";

  if (newPw.length < 6) {
    showMsg(msgEl, "A senha deve ter no mínimo 6 caracteres.", "error");
    return;
  }

  if (newPw !== confirmPw) {
    showMsg(msgEl, "As senhas não coincidem.", "error");
    return;
  }

  btnSpan.textContent = "Salvando...";
  btn.disabled = true;

  try {
    await updatePassword(newPw);
    e.target.reset();
    showMsg(msgEl, "Senha alterada com sucesso!", "success");
  } catch (err) {
    showMsg(msgEl, err.message || "Erro ao alterar a senha.", "error");
  } finally {
    btnSpan.textContent = "Alterar senha";
    btn.disabled = false;
  }
});

function showMsg(el, text, type) {
  el.textContent = text;
  el.className = `settings-msg is-${type}`;
}

// ----------------------------------------------------------
// LOGOUT
// ----------------------------------------------------------

document.getElementById("logoutBtn").addEventListener("click", () => {
  logout();
});

// ----------------------------------------------------------
// MEMÓRIAS
// ----------------------------------------------------------

const AGENT_LABELS = {
  financial_management: "Gestão Financeira",
  general: "Geral"
};

async function loadMemories() {
  const list = document.getElementById("memoriesList");
  if (!list) return;

  try {
    const memories = await getAllMemories();

    list.innerHTML = "";

    if (memories.length === 0) {
      list.innerHTML = '<p class="memories-empty">Nenhuma memória salva ainda. Converse com a IA para ela aprender sobre você.</p>';
      return;
    }

    memories.forEach(memory => {
      const item = document.createElement("div");
      item.className = "memory-item";

      const badge = document.createElement("span");
      badge.className = "memory-badge";
      badge.textContent = AGENT_LABELS[memory.assistant_type] || memory.assistant_type;

      const text = document.createElement("p");
      text.className = "memory-text";
      text.textContent = memory.content;

      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "memory-delete-btn";
      delBtn.title = "Deletar memória";
      delBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>`;
      delBtn.addEventListener("click", async () => {
        delBtn.disabled = true;
        try {
          await deleteMemory(memory.id);
          item.remove();
          if (list.children.length === 0) {
            list.innerHTML = '<p class="memories-empty">Nenhuma memória salva ainda.</p>';
          }
        } catch {
          delBtn.disabled = false;
        }
      });

      item.appendChild(badge);
      item.appendChild(text);
      item.appendChild(delBtn);
      list.appendChild(item);
    });
  } catch {
    list.innerHTML = '<p class="memories-empty">Erro ao carregar memórias.</p>';
  }
}

// ----------------------------------------------------------
// INIT
// ----------------------------------------------------------

loadProfile();
loadMemories();
