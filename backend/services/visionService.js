const {
  GoogleGenAI,
  createPartFromUri,
  createUserContent
} = require("@google/genai");
const mime = require("mime-types");
const { createUserFacingGeminiError } = require("./geminiErrorService");

const client = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY
});

const IMAGE_MODEL_TIMEOUT_MS = Number(process.env.GEMINI_IMAGE_TIMEOUT_MS) || 35000;

const DEFAULT_IMAGE_MODELS = [
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

async function analyzeWithModel(model, uploadedFile, mimeType, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const timeoutError = new Error(
        `Tempo limite ao analisar imagem com o modelo ${model}.`
      );
      timeoutError.code = "MODEL_TIMEOUT";
      timeoutError.status = 504;
      timeoutError.model = model;
      reject(timeoutError);
    }, IMAGE_MODEL_TIMEOUT_MS);

    client.models
      .generateContent({
        model,
        contents: createUserContent([
          createPartFromUri(uploadedFile.uri, uploadedFile.mimeType || mimeType),
          message || "Analise esta imagem. Descreva o que aparece nela e responda em portugues."
        ])
      })
      .then((response) => {
        clearTimeout(timer);
        resolve(response);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

async function analyzeImageWithGemini(file, message) {
  const mimeType =
    file.mimetype || mime.lookup(file.originalname || "") || "application/octet-stream";

  if (!String(mimeType).startsWith("image/")) {
    throw new Error("O arquivo enviado nao foi reconhecido como uma imagem valida.");
  }

  let uploadedFile;

  try {
    uploadedFile = await client.files.upload({
      file: file.path,
      config: { mimeType }
    });

    const candidates = getModelCandidates("GEMINI_IMAGE_MODELS", DEFAULT_IMAGE_MODELS);
    let lastError;

    for (const model of candidates) {
      try {
        const response = await analyzeWithModel(
          model,
          uploadedFile,
          mimeType,
          message
        );

        return response.text || "Nao consegui analisar a imagem";
      } catch (error) {
        lastError = error;
        console.log(
          `Gemini falhou na imagem com o modelo ${model} (${error.code || error.status || "erro"}), tentando proximo...`
        );
      }
    }

    const errorText = lastError?.message || "";

    if (
      errorText.includes("Unable to process input image") ||
      errorText.includes('"status":"INVALID_ARGUMENT"') ||
      errorText.includes('"status":"INTERNAL"')
    ) {
      throw new Error(
        "Nao foi possivel analisar essa imagem no momento. Verifique se o arquivo abre normalmente, use PNG, JPG, JPEG ou WEBP e, se preciso, tente uma imagem menor."
      );
    }

    if (lastError?.code === "MODEL_TIMEOUT") {
      const timeoutError = new Error(
        "A analise da imagem demorou alem do esperado. Tente novamente ou use uma imagem menor."
      );
      timeoutError.status = 504;
      throw timeoutError;
    }

    throw createUserFacingGeminiError(lastError, "image");
  } finally {
    if (uploadedFile?.name) {
      try {
        await client.files.delete({ name: uploadedFile.name });
      } catch (cleanupError) {
        console.error(
          "Falha ao remover arquivo temporario do Gemini:",
          cleanupError.message
        );
      }
    }
  }
}

module.exports = { analyzeImageWithGemini };
