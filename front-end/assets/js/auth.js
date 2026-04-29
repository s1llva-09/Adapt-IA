//importa o cliente (função supabse) de dentro do arquivo supabaseClient
import { supabse } from "./supabaseClient"

//================================
//Função de cadastro (SIGN UP)
//================================

export async function signUp(email, password) {
    try {
        //chama o supabase para criação de usuario
        const { data, error } = await supabse.auth.signUp({
            email: email, //passa email digitado pelo usuario
            password: password //senha digitada
        })

        //se deu erro lança para o catch
        if (error) throw error

        return {
            success: true,
            message: "Conta criada com sucesso verifique o seu email."
        }

    } catch (error) {
        console.error("Erro no cadastro:", error)

        return {
            success: false,
            message: error.message
        }
    }
}


//=================================
//FUNÇÃO DE LOGIN
//=================================
export async function signIn(email, password) {
    try {
        //aciona o comando para efetuar login com email e senha
        const { data, error } = await supabse.auth.signInWithPassword({
            email: email,
            password: password
        })
        //se consta erro vai lançar para o catch
        if (error) throw error

        console.log("Usuário logado:", data)

        return {
            success: true,
            message: "Login realizado com sucesso!"
        }

    } catch (error) {
        console.error("Erro no login:", error)

        return {
            success: false,
            message: error.message
        }
    }
}

//==============================
//FUNÇÃO DE SAIR
//==============================

export async function logout() {
    try {
        //faz logout do usuario logado no momento
        const { error } = await supabse.auth.signOut()

        if (error) throw error

        console.log("Usuário deslogado")
        //volta para a pagina de login
        window.location.href = "login.html"
    } catch (error) {
        console.error("Erro ao sair:", error)
    }
}

//==============================
//VERIFICAÇÃO DE USUARIO LOGADO OU NAO
//==============================

export async function getUser() {
    //pega o atual usuario logado
    const { data } = await supabse.auth.getUser()

    return data.user
}

//===============================
//FUNÇÃO DE PROTEÇÃO DA PAGINA
//===============================

export async function protectPage() {
    const user = await getUser()

    //se nao tiver usuario logado
    if(!user) {
        console.log("Usuário não logado → redirecionando")

        window.location.href = "login.html"
    }else{
        console.log("Usuário autenticado:", user.email)
    }
}