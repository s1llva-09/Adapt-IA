// Controlador da tela register.html.
// Ele valida os campos, chama o cadastro no Supabase e mostra o resultado para o usuario.
import { signUp } from "./auth.js";

// Elementos do formulario de cadastro.
const registerForm = document.getElementById("registerForm");
const nameInput = document.getElementById("name");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const confirmPasswordInput = document.getElementById("confirmPassword");
const registerBtn = document.getElementById("registerBtn");
const message = document.getElementById("message");

// Configura os botões de olho para mostrar/esconder senha.
// A tela de cadastro tem dois campos: password e confirmPassword.
// Cada botão informa qual input controla via data-toggle-password.
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

// Mostra feedback abaixo do formulario.
// O CSS muda a cor de acordo com data-type: info, success ou error.
function showMessage(text, type = "") {
  message.textContent = text;
  message.dataset.type = type;
}

// Desativa o botao durante a criacao da conta.
function setLoading(isLoading) {
  registerBtn.disabled = isLoading;
  registerBtn.textContent = isLoading ? "Criando..." : "Criar conta";
}

// Submit do formulario de cadastro.
registerForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const name = nameInput.value.trim();
  const email = emailInput.value.trim();
  const password = passwordInput.value.trim();
  const confirmPassword = confirmPasswordInput.value.trim();

  if (!name || !email || !password || !confirmPassword) {
    showMessage("Preencha todos os campos.", "error");
    return;
  }

  if (password.length < 6) {
    showMessage("A senha precisa ter pelo menos 6 caracteres.", "error");
    return;
  }

  if (password !== confirmPassword) {
    showMessage("As senhas não conferem.", "error");
    return;
  }

  setLoading(true);
  showMessage("Criando sua conta...", "info");

  const result = await signUp(email, password, name);

  setLoading(false);
  showMessage(result.message, result.success ? "success" : "error");

  // Em muitos projetos Supabase, o usuario precisa confirmar o e-mail antes de entrar.
  // Por isso limpamos o formulario e mantemos a mensagem de orientacao na tela.
  if (result.success) {
    registerForm.reset();
  }
});

setupPasswordToggles();
