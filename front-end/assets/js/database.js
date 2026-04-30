// Este arquivo centraliza todo acesso as tabelas do Supabase.
// Assim o chat.js nao precisa saber detalhes de tabela, user_id, select, insert etc.
import { supabase } from "./supabaseClient.js";

// Busca o usuario autenticado no Supabase.
// Todas as operacoes de conversa dependem desse usuario para salvar o user_id correto.
async function getLoggedUser() {
  const { data, error } = await supabase.auth.getUser();

  if (error) throw error;
  if (!data.user) throw new Error("Usuario nao esta logado.");

  return data.user;
}

// Cria uma conversa nova na tabela "conversations".
// Retorna o registro criado, incluindo o id usado para salvar as mensagens.
export async function createConversation(title = "Nova conversa") {
  const user = await getLoggedUser();

  const { data, error } = await supabase
    .from("conversations")
    .insert({
      user_id: user.id,
      title
    })
    .select()
    .single();

  if (error) throw error;

  return data;
}

// Lista as conversas do usuario logado, da mais recente para a mais antiga.
// Essa funcao ja esta pronta para uma futura sidebar com historico de conversas.
export async function getConversations() {
  const user = await getLoggedUser();

  const { data, error } = await supabase
    .from("conversations")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) throw error;

  return data || [];
}

// Salva uma mensagem na tabela "messages".
// Tambem guarda metadados de anexo, quando a mensagem veio com arquivo/imagem.
export async function saveMessage(conversationId, role, content, attachment = null) {
  const user = await getLoggedUser();

  const { data, error } = await supabase
    .from("messages")
    .insert({
      conversation_id: conversationId,
      user_id: user.id,
      role,
      content,
      attachment_name: attachment?.name || null,
      attachment_type: attachment?.type || null
    })
    .select()
    .single();

  if (error) throw error;

  return data;
}

// Busca todas as mensagens de uma conversa, na ordem em que foram criadas.
// O chat usa isso quando abre a tela para restaurar o historico.
export async function getMessages(conversationId) {
  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  if (error) throw error;

  return data || [];
}

// Apaga uma conversa.
// Se houver cascade no banco, as mensagens dela tambem podem ser apagadas junto.
export async function deleteConversation(conversationId) {
  const { error } = await supabase
    .from("conversations")
    .delete()
    .eq("id", conversationId);

  if (error) throw error;

  return true;
}
