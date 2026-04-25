// Multer recebe os arquivos enviados pelo front-end.

const fs = require("fs");
const path = require("path");
const mammoth = require("mammoth");
const pdfParseModule = require("pdf-parse");

// Lista de arquivos que podem ser lidos como texto diretamente
const TEXT_EXTENSIONS = [
  ".txt",
  ".js",
  ".html",
  ".css",
  ".json",
  ".md",
  ".csv",
  ".xml",
  ".sql",
  ".java",
  ".py",
  ".php",
  ".c",
  ".cpp"
];

// Lista de imagens suportadas
const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp"];

// Verifica se o arquivo e imagem
function isImageFile(file) {
  const ext = path.extname(file.originalname || "").toLowerCase();
  return file.mimetype?.startsWith("image/") || IMAGE_EXTENSIONS.includes(ext);
}

async function extractPdfText(filePath) {
  const buffer = fs.readFileSync(filePath);

  // Compatibilidade com pdf-parse antigo (funcao direta)
  if (typeof pdfParseModule === "function") {
    const result = await pdfParseModule(buffer);
    return result?.text || "";
  }

  // Compatibilidade com pdf-parse novo (classe PDFParse)
  if (typeof pdfParseModule?.PDFParse === "function") {
    const parser = new pdfParseModule.PDFParse({ data: buffer });

    try {
      const result = await parser.getText();
      return result?.text || "";
    } finally {
      if (typeof parser.destroy === "function") {
        await parser.destroy();
      }
    }
  }

  throw new Error("Versao de pdf-parse sem parser compativel para extracao de texto.");
}

// Funcao para ler o arquivo recebido
async function extractFileContent(file) {
  const ext = path.extname(file.originalname).toLowerCase();

  if (TEXT_EXTENSIONS.includes(ext)) {
    return fs.readFileSync(file.path, "utf8");
  }

  if (ext === ".docx") {
    const result = await mammoth.extractRawText({
      path: file.path
    });

    return result.value;
  }

  if (ext === ".pdf") {
    const pdfText = await extractPdfText(file.path);

    if (!pdfText?.trim()) {
      return "O PDF foi recebido, mas nao possui texto extraivel. Pode ser um PDF escaneado em imagem. Nesse caso, envie em DOCX/TXT ou use OCR antes do envio.";
    }

    return pdfText;
  }

  return `Arquivo recebido: ${file.originalname}, mas esse tipo ainda nao tem extracao configurada`;
}

module.exports = {
  extractFileContent,
  isImageFile
};
