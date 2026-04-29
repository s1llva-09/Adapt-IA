// Importa as funções de login e cadastro do auth.js
import { signIn, signUp } from "./auth.js";

// Pega os elementos do HTML
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const loginBtn = document.getElementById("loginBtn");
const signupBtn = document.getElementById("signupBtn");
const message = document.getElementById("message");

// Função para mostrar mensagens na tela
function showMessage(text) {
  message.textContent = text;
}

// Login
loginBtn.addEventListener("click", async () => {
  const email = emailInput.value.trim();
  const password = passwordInput.value.trim();

  if (!email || !password) {
    showMessage("Preencha e-mail e senha.");
    return;
  }

  showMessage("Entrando...");

  const result = await signIn(email, password);

  showMessage(result.message);

  if (result.success) {
    window.location.href = "index.html";
  }
});

// Cadastro
signupBtn.addEventListener("click", async () => {
  const email = emailInput.value.trim();
  const password = passwordInput.value.trim();

  if (!email || !password) {
    showMessage("Preencha e-mail e senha.");
    return;
  }

  if (password.length < 6) {
    showMessage("A senha precisa ter pelo menos 6 caracteres.");
    return;
  }

  showMessage("Criando conta...");

  const result = await signUp(email, password);

  showMessage(result.message);
});