// Funcoes de autenticacao da aplicacao.
// Qualquer tela que precise criar conta, entrar, sair ou proteger acesso usa este arquivo.
import { supabase } from "./supabaseClient.js";

// Cria um usuario no Supabase Auth.
// O nome vai em user_metadata, para podermos recuperar depois se precisar.
export async function signUp(email, password, name = "") {
  try {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          name
        }
      }
    });

    if (error) throw error;

    return {
      success: true,
      message: "Conta criada com sucesso. Verifique seu e-mail para confirmar o cadastro."
    };
  } catch (error) {
    console.error("Erro no cadastro:", error);

    return {
      success: false,
      message: error.message || "Nao foi possivel criar sua conta."
    };
  }
}

// Faz login usando e-mail e senha.
// Quando da certo, o Supabase salva a sessao no navegador automaticamente.
export async function signIn(email, password) {
  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error) throw error;

    console.log("Usuario logado:", data);

    return {
      success: true,
      message: "Login realizado com sucesso."
    };
  } catch (error) {
    console.error("Erro no login:", error);

    return {
      success: false,
      message: error.message || "Nao foi possivel entrar."
    };
  }
}

// Encerra a sessao do usuario e volta para a tela de login.
export async function logout() {
  try {
    const { error } = await supabase.auth.signOut();

    if (error) throw error;

    window.location.href = "login.html";
  } catch (error) {
    console.error("Erro ao sair:", error);
  }
}

// Retorna o usuario atual, se existir uma sessao ativa.
export async function getUser() {
  const { data } = await supabase.auth.getUser();
  return data.user;
}

// Protege paginas internas.
// Se nao houver usuario logado, redireciona para login.html.
export async function protectPage() {
  const user = await getUser();

  if (!user) {
    console.log("Usuario nao logado, redirecionando.");
    window.location.href = "login.html";
    return;
  }

  console.log("Usuario autenticado:", user.email);
}
