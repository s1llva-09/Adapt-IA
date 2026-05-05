// Controlador da tela login.html.
// Ele pega os dados digitados, chama o Supabase via auth.js e mostra feedback na tela.
import { signIn } from "./auth.js";

// Elementos do formulario.
const loginForm = document.getElementById("loginForm");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const loginBtn = document.getElementById("loginBtn");
const message = document.getElementById("message");

// Configura o botão de olho para mostrar/esconder a senha.
// O botão tem data-toggle-password="password", então esta função
// localiza o input pelo id e alterna entre type="password" e type="text".
function setupPasswordToggles() {
  document.querySelectorAll("[data-toggle-password]").forEach((button) => {
    const inputId = button.dataset.togglePassword;
    const input = document.getElementById(inputId);

    if (!input) return;

    button.addEventListener("click", () => {
      const shouldShowPassword = input.type === "password";

      input.type = shouldShowPassword ? "text" : "password";
      button.classList.toggle("is-visible", shouldShowPassword);
      button.setAttribute("aria-pressed", String(shouldShowPassword));
      button.setAttribute(
        "aria-label",
        shouldShowPassword ? "Ocultar senha" : "Mostrar senha"
      );
      button.title = shouldShowPassword ? "Ocultar senha" : "Mostrar senha";
    });
  });
}

// Mostra mensagens de status abaixo do formulario.
// O data-type muda a cor pelo CSS: info, success ou error.
function showMessage(text, type = "") {
  message.textContent = text;
  message.dataset.type = type;
}

// Bloqueia o botao enquanto o login esta em andamento.
// Isso evita varios cliques e varias tentativas ao mesmo tempo.
function setLoading(isLoading) {
  loginBtn.disabled = isLoading;
  loginBtn.textContent = isLoading ? "Entrando..." : "Entrar";
}

// Submit do formulario de login.
loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const email = emailInput.value.trim();
  const password = passwordInput.value.trim();

  if (!email || !password) {
    showMessage("Preencha e-mail e senha.", "error");
    return;
  }

  setLoading(true);
  showMessage("Validando acesso...", "info");

  const result = await signIn(email, password);

  setLoading(false);
  showMessage(result.message, result.success ? "success" : "error");

  // Login aprovado: leva para a tela inicial protegida.
  if (result.success) {
    window.location.href = "index.html";
  }
});

setupPasswordToggles();
