// ============================================================
// SERVIÇO DE COMUNICAÇÃO COM GEMINI - AdaptIA
// ============================================================
// Este serviço gerencia toda a comunicação com a API do Google
// Gemini. Ele envia mensagens, trata erros, implementa retry
// automático e fallback para modelos alternativos.
// ============================================================

// ----------------------------------------------------------
// IMPORTAÇÕES
// ----------------------------------------------------------

// GoogleGenAI: Biblioteca oficial do Google para acessar
// os modelos Gemini
const { GoogleGenAI } = require("@google/genai");

// ----------------------------------------------------------
// CRIAÇÃO DO CLIENTE GEMINI
// ----------------------------------------------------------

// Inicializa o cliente com a API Key do arquivo .env
const client = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY
});

// ----------------------------------------------------------
// FUNÇÃO AUXILIAR: DELAY (ESPERA)
// ----------------------------------------------------------
// Cria uma promessa que resolve após X milissegundos
// Usada para implementar espera entre tentativas de retry

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ----------------------------------------------------------
// FUNÇÃO PRINCIPAL: ENVIAR MENSAGENS PARA GEMINI
// ----------------------------------------------------------
// Converte o histórico de mensagens, envia para a API do
// Gemini e retorna a resposta. Inclui retry automático e
// fallback para modelo alternativo.

async function sendToGemini(messages) {

  // --------------------------------------------------------
  // CONVERSÃO DO HISTÓRICO PARA TEXTO
  // --------------------------------------------------------
  // O Gemini espera um texto simples (não JSON estruturado)
  // Por isso convertemos o array de mensagens em uma string
  const prompt = messages
    .map((msg) => {
      // Mensagens do sistema são prefixadas com "Sistema:"
      if (msg.role === "system") return `Sistema: ${msg.content}`;
      // Mensagens da IA são prefixadas com "IA:"
      if (msg.role === "assistant") return `IA: ${msg.content}`;
      // Mensagens do usuário são prefixadas com "Usuário:"
      return `Usuário: ${msg.content}`;
    })
    .join("\n"); // Une todas as mensagens com quebra de linha

  // --------------------------------------------------------
  // LOGS DE DEBUG
  // --------------------------------------------------------
  console.log("Enviando para Gemini...");
  console.log("Quantidade de mensagens:", messages.length);
  console.log("Tamanho do prompt:", prompt.length);

  // --------------------------------------------------------
  // SISTEMA DE RETRY (TENTATIVAS AUTOMÁTICAS)
  // --------------------------------------------------------
  // Se a API falhar por sobrecarga, tenta novamente
  // até 3 vezes esperando entre cada tentativa
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      console.log(`Tentativa Gemini ${attempt}/${maxAttempts}`);

      // Envia a mensagem para o Gemini
      const response = await client.models.generateContent({
        // Modelo principal: Gemini 2.5 Pro (chave paga)
        model: "gemini-2.5-pro",
        
        // Conteúdo: texto simples convertido do histórico
        contents: prompt
      });

      console.log("Gemini respondeu OK");

      // Retorna o texto da resposta ou mensagem padrão
      return response.text || "Sem resposta.";

    } catch (error) {
      // --------------------------------------------------------
      // TRATAMENTO DE ERROS
      // --------------------------------------------------------
      console.error("Erro no Gemini:", error);

      // Extrai a mensagem de erro para análise
      const errorText = error.message || "";

      // --------------------------------------------------------
      // VERIFICA SE O ERRO É TEMPORÁRIO
      // --------------------------------------------------------
      // Erros temporários (sofrecomenda, indisponibilidade)
      // merecem retry. Outros erros são falhas permanentes.
      const isTemporary =
        errorText.includes("503") || // Service Unavailable
        errorText.includes("UNAVAILABLE") || // Recurso indisponível
        errorText.includes("high demand"); // Alta demanda

      // --------------------------------------------------------
      // FALLBACK: TENTA MODELO ALTERNATIVO
      // --------------------------------------------------------
      // Se o erro não for temporário, tenta usar um modelo
      // mais potente (gemini-2.5-flash) como alternativa
      if (!isTemporary) {
        console.log("Tentando fallback para modelo secundário...");

        try {
          // Tenta modelo de fallback
          const fallbackResponse = await client.models.generateContent({
            model: "gemini-2.5-flash",
            contents: prompt
          });

          console.log("Fallback Gemini respondeu OK");

          return fallbackResponse.text || "Sem resposta.";
        } catch (fallbackError) {
          // Se o fallback também falhar, propagamos o erro
          console.error("Erro no fallback Gemini:", fallbackError);
          throw new Error(fallbackError.message || "Erro ao consultar Gemini.");
        }
      }

      // --------------------------------------------------------
      // RETRY: ESPERA E TENTA NOVAMENTE
      // --------------------------------------------------------
      // Se todas as tentativas falharam, lança erro
      if (attempt === maxAttempts) {
        throw new Error(
          "Gemini está com alta demanda. Tente novamente em alguns segundos."
        );
      }

      // Espera progressivamente mais tempo entre tentativas
      // (1.5s, 3s, 4.5s) para não sobrecarregar a API
      await delay(1500 * attempt);
    }
  }
}

// Igual ao sendToGemini, mas envia cada pedaço assim que chega.
// onChunk é chamado com cada texto parcial recebido.
// Retorna o texto completo ao final.
async function sendToGeminiStream(messages, onChunk) {
  const prompt = messages
    .map((msg) => {
      if (msg.role === "system") return `Sistema: ${msg.content}`
      if (msg.role === "assistant") return `IA: ${msg.content}`
      return `Usuário: ${msg.content}`
    })
    .join("\n")

  console.log("Iniciando stream Gemini...")

  // Tenta gemini-2.5-pro primeiro; se falhar, cai para gemini-2.5-flash
  const modelsToTry = ["gemini-2.5-pro", "gemini-2.5-flash"]

  for (const model of modelsToTry) {
    try {
      console.log(`Stream tentando modelo: ${model}`)

      const stream = await client.models.generateContentStream({
        model,
        contents: prompt
      })

      let fullText = ""

      for await (const chunk of stream) {
        const text = chunk.text || ""
        if (text) {
          fullText += text
          onChunk(text)
        }
      }

      return fullText

    } catch (error) {
      console.error(`Stream falhou com ${model}:`, error.message)

      // Se ainda há outro modelo para tentar, continua
      if (model !== modelsToTry[modelsToTry.length - 1]) {
        console.log("Tentando próximo modelo...")
        continue
      }

      // Último modelo também falhou
      throw new Error(error.message || "Erro ao gerar resposta com Gemini.")
    }
  }
}

// ----------------------------------------------------------
// EXPORTAÇÃO
// ----------------------------------------------------------
// Exporta a função para ser usada em server.js

module.exports = { sendToGemini, sendToGeminiStream };