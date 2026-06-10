import { protectPage, getUser, getSession, updatePassword, logout } from "./auth.js";
import { fetchWithFallback } from "./api.js";

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
    input.type = input.type === "password" ? "text" : "password";
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
// INIT
// ----------------------------------------------------------

loadProfile();
