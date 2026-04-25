//Serviço para analise real de imagens

//importar cliente gemini
const { GoogleGenAI } = require("@google/genai")

//le o arquivo da image em binare
const fs = require("fs")

// Detecta o tipo MIME do arquivo
const mime = require("mime-types")

// Cria o cliente Gemini usando a chave do .env
const client = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY
})

//analisa uma imagem usando Gemini multimodal
async function analyzeImageWithGemini(file, message) {
    //descobre o tipo da imagem(png, jpeg, etc)
    const mimeType = mime.lookup(file.originalname || file.mimeType || "image/png")

    //lê a image e converte para base64
    const imageBase64 = fs.readFileSync(file.path).toString("base64")

    //chama o gemini com o texto + image
    const response = await client.models.generateContent({
        model: "gemini-2.5-flash-lite",
        contents: [
            {
                role: "user",
                parts: [
                    {
                        text:
                        message ||
                        "Analise esta imagem. Descreva oq aparece nela e responsa em português"
                    },
                    {
                        inlineData: {
                            mimeType,
                            data: imageBase64
                        }
                    }
                ]
            }
        ]
    })

    return response.text || "Não consegui analisar a imagem"
}
module.exports = { analyzeImageWithGemini }