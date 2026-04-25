const { GoogleGenAI } = require("@google/genai");
const {
  createUserFacingGeminiError,
  isGeminiTemporaryError
} = require("./geminiErrorService");

const client = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY
});

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const MODEL_TIMEOUT_MS = Number(process.env.GEMINI_MODEL_TIMEOUT_MS) || 30000;

const DEFAULT_CHAT_MODELS = [
  "gemini-3.1-flash-lite-preview",
  "gemini-flash-lite-latest",
  "gemini-flash-latest",
  "gemini-2.5-flash"
];

function getModelCandidates(envVarName, defaults) {
  const envValue = process.env[envVarName];

  if (!envValue) return defaults;

  const parsed = envValue
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  return parsed.length ? parsed : defaults;
}

function buildPrompt(messages) {
  return messages
    .map((msg) => {
      if (msg.role === "system") return `Sistema: ${msg.content}`;
      if (msg.role === "assistant") return `IA: ${msg.content}`;
      return `Usuario: ${msg.content}`;
    })
    .join("\n");
}

function withTimeout(promise, model) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const timeoutError = new Error(
        `Tempo limite ao consultar o modelo ${model}.`
      );
      timeoutError.code = "MODEL_TIMEOUT";
      timeoutError.status = 504;
      timeoutError.model = model;
      reject(timeoutError);
    }, MODEL_TIMEOUT_MS);

    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

async function generateWithModel(model, prompt) {
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await withTimeout(
        client.models.generateContent({
          model,
          contents: prompt
        }),
        model
      );
    } catch (error) {
      if (!isGeminiTemporaryError(error) || attempt === maxAttempts) {
        throw error;
      }

      await delay(1500 * attempt);
    }
  }
}

async function sendToGemini(messages) {
  const prompt = buildPrompt(messages);
  const candidates = getModelCandidates("GEMINI_CHAT_MODELS", DEFAULT_CHAT_MODELS);
  let lastError;

  for (const model of candidates) {
    try {
      const response = await generateWithModel(model, prompt);
      return response.text || "Sem resposta.";
    } catch (error) {
      lastError = error;
      console.log(
        `Gemini falhou no modelo ${model} (${error.code || error.status || "erro"}), tentando proximo...`
      );
    }
  }

  if (lastError) {
    if (lastError.code === "MODEL_TIMEOUT") {
      const timeoutError = new Error(
        "Os modelos Gemini demoraram para responder. Tente novamente em instantes."
      );
      timeoutError.status = 504;
      throw timeoutError;
    }

    throw createUserFacingGeminiError(lastError, "chat");
  }

  throw new Error("Nenhum modelo Gemini disponivel para gerar resposta.");
}

module.exports = { sendToGemini };
