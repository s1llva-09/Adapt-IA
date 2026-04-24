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