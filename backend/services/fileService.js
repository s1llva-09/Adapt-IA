// ===============================
// IMPORTAÇÕES
// ===============================

// fs → usado para ler arquivos do sistema
const fs = require("fs");

// path → ajuda a trabalhar com caminhos de arquivos
const path = require("path");

// pdf-parse → biblioteca que tenta extrair texto de PDFs
const pdfParse = require("pdf-parse");

// child_process → permite executar comandos do sistema (ex: converter PDF em imagem)
const { exec } = require("child_process");


// ===============================
// FUNÇÃO PRINCIPAL
// ===============================

// Essa função recebe um arquivo enviado pelo usuário
// e decide COMO ele deve ser interpretado:
// - texto
// - imagem
// - PDF (com ou sem texto)
async function extractFileContent(file) {

  // Caminho físico do arquivo no servidor
  const filePath = file.path;

  // Tipo do arquivo (ex: application/pdf, image/png)
  const mimeType = file.mimetype;

  console.log("Tipo do arquivo:", mimeType);

  // ===============================
  // 📄 TRATAMENTO DE PDF
  // ===============================

  if (mimeType === "application/pdf") {

    // Lê o arquivo PDF como binário (buffer)
    const buffer = fs.readFileSync(filePath);

    // Tenta extrair texto do PDF
    const data = await pdfParse(buffer);

    // Remove espaços desnecessários
    const text = data.text.trim();

    console.log("Texto extraído do PDF:", text.length);

    // 🔥 CASO 1: PDF TEM TEXTO REAL
    // Ex: currículo feito no Word
    if (text.length > 50) {

      console.log("PDF contém texto → enviando como texto");

      return {
        type: "text", // indica que é texto
        content: text // conteúdo que será enviado para IA
      };
    }

    // 🔥 CASO 2: PDF NÃO TEM TEXTO
    // Ex: logo, scan, print
    console.log("PDF sem texto → convertendo para imagem...");

    // Define onde salvar a imagem gerada
    const outputDir = path.join(__dirname, "../uploads");

    // Converte PDF em imagem usando comando externo (Poppler)
    return new Promise((resolve, reject) => {

      exec(
        // Converte primeira página do PDF em PNG
        `pdftoppm -png "${filePath}" "${outputDir}/output"`,
        (err) => {

          if (err) {
            console.error("Erro ao converter PDF:", err);
            reject(err);
            return;
          }

          // Caminho da imagem gerada (primeira página)
          const imagePath = path.join(outputDir, "output-1.png");

          console.log("PDF convertido em imagem:", imagePath);

          // Retorna como imagem (para IA de visão)
          resolve({
            type: "image",
            content: imagePath
          });
        }
      );
    });
  }

  // ===============================
  // 🖼️ TRATAMENTO DE IMAGEM
  // ===============================

  if (mimeType.startsWith("image/")) {

    console.log("Arquivo é imagem → enviando para IA de visão");

    return {
      type: "image",
      content: filePath
    };
  }

  // ===============================
  // 📝 TRATAMENTO DE TEXTO / CÓDIGO
  // ===============================

  console.log("Arquivo é texto/código → lendo conteúdo");

  // Lê o arquivo como texto
  const text = fs.readFileSync(filePath, "utf-8");

  return {
    type: "text",
    content: text
  };
}


// ===============================
// EXPORTAÇÃO
// ===============================

// Exporta a função para ser usada no server.js
module.exports = {
  extractFileContent
};