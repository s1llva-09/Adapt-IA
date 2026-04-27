// ============================================================
// SERVIÇO DE COMUNICAÇÃO COM OPENAI - AdaptIA
// ============================================================
// Este serviço gerencia a comunicação com a API da OpenAI.
// É mais simples que o Gemini pois não precisa de retry
// ou fallback complexo.
// ============================================================

// ----------------------------------------------------------
// IMPORTAÇÕES
// ----------------------------------------------------------

// OpenAI: Biblioteca oficial da OpenAI para Node.js
// Permite acessar os modelos GPT (ChatGPT)
const OpenAI = require("openai");

// ----------------------------------------------------------
// CRIAÇÃO DO CLIENTE OPENAI
// ----------------------------------------------------------

// Inicializa o cliente com a API Key do arquivo .env
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// ----------------------------------------------------------
// FUNÇÃO PRINCIPAL: ENVIAR MENSAGENS PARA OPENAI
// ----------------------------------------------------------
// Envia o histórico de mensagens para a API da OpenAI
// e retorna a resposta da IA.

async function sendToOpenAI(messages) {
  // Faz a chamada para a API de completion do ChatGPT
  const response = await client.chat.completions.create({
    // Modelo utilizado: GPT-4o Mini
    // Modelo mais novo, rápido e com bom custo-benefício
    // Alternativas: gpt-4, gpt-4-turbo, gpt-3.5-turbo
    model: "gpt-4o-mini",
    
    // Mensagens: array de objetos com role e content
    // Estrutura esperada:
    // [
    //   { role: "system", content: "Você é um assistente..." },
    //   { role: "user", content: "Olá" },
    //   { role: "assistant", content: "Olá! Como posso ajudar?" }
    // ]
    messages
  });

  // Retorna o conteúdo da primeira resposta
  // choices[0] é a resposta principal
  // message.content é o texto da resposta
  return response.choices[0].message.content;
}

// ----------------------------------------------------------
// EXPORTAÇÃO
// ----------------------------------------------------------
// Exporta a função para ser usada em server.js

module.exports = { sendToOpenAI };