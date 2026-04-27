// ============================================================
// SERVIÇO DE EXTRAÇÃO DE CONTEÚDO - AdaptIA
// ============================================================
// Este serviço determina o tipo de arquivo recebido e decide
// como processá-lo: extrair texto, converter para imagem, ou
// retornar o caminho do arquivo.
// ============================================================

// ----------------------------------------------------------
// IMPORTAÇÕES
// ----------------------------------------------------------

// fs (File System): Módulo nativo do Node.js para ler
// arquivos do sistema de arquivos
const fs = require("fs");

// path: Utilitário para manipular caminhos de arquivos
// (unir diretórios, extrair extensão, etc)
const path = require("path");

// pdf-parse: Biblioteca que extrai texto de arquivos PDF
// (funciona apenas para PDFs que têm texto reconhecível,
// não para PDFs que são apenas imagens escaneadas)
const pdfParse = require("pdf-parse");

// child_process: Módulo do Node.js para executar comandos
// do sistema operacional (usado aqui para converter PDF
// em imagem usando ferramentas externas como Poppler)
const { exec } = require("child_process");

// ----------------------------------------------------------
// FUNÇÃO PRINCIPAL: EXTRAIR CONTEÚDO DO ARQUIVO
// ----------------------------------------------------------
// Esta função recebe um arquivo e decide automaticamente
// como ele deve ser processado:
// - Se for PDF com texto: extrai o texto
// - Se for PDF escaneado (imagem): converte para PNG
// - Se for imagem: retorna o caminho
// - Se for texto/código: lê o conteúdo

async function extractFileContent(file) {

  // Caminho físico do arquivo temporário no servidor
  const filePath = file.path;

  // Tipo MIME do arquivo (ex: application/pdf, image/png)
  // Usado para determinar como processar o arquivo
  const mimeType = file.mimetype;

  console.log("Tipo do arquivo:", mimeType);

  // ========================================================
  // PROCESSAMENTO DE PDF
  // ========================================================
  if (mimeType === "application/pdf") {

    // Lê o arquivo PDF como binário (buffer)
    // Buffer é uma representação em memória de dados binários
    const buffer = fs.readFileSync(filePath);

    // Tenta extrair texto do PDF usando pdf-parse
    // Pode falhar se o PDF for apenas imagens (escaneado)
    const data = await pdfParse(buffer);

    // Remove espaços desnecessários do início e fim
    const text = data.text.trim();

    console.log("Texto extraído do PDF:", text.length);

    // ------------------------------------------------------
    // CASO 1: PDF CONTÉM TEXTO RECONHECÍVEL
    // ------------------------------------------------------
    // Ex: Currículo criado no Word, contrato digital, etc
    if (text.length > 50) {
      console.log("PDF contém texto → enviando como texto");

      // Retorna um objeto indicando que é texto
      return {
        type: "text", // tipo do conteúdo
        content: text // texto extraído do PDF
      };
    }

    // ------------------------------------------------------
    // CASO 2: PDF NÃO TEM TEXTO (É ESCANEADO/IMAGEM)
    // ------------------------------------------------------
    // Ex: Foto de documento, PDF gerado de scanner, etc
    console.log("PDF sem texto → convertendo para imagem...");

    // Define onde salvar a imagem gerada
    const outputDir = path.join(__dirname, "../uploads");

    // Converte PDF em imagem usando comando externo (Poppler)
    // O comando pdftoppm converte PDF para PPM (imagem)
    // Flags usadas:
    //   -png: output em PNG
    //   -png: primeira página apenas (gera output-1.png)
    return new Promise((resolve, reject) => {

      exec(
        `pdftoppm -png "${filePath}" "${outputDir}/output"`,
        (err) => {
          if (err) {
            // Erro ao executar o comando de conversão
            console.error("Erro ao converter PDF:", err);
            reject(err);
            return;
          }

          // Caminho da imagem gerada (primeira página do PDF)
          const imagePath = path.join(outputDir, "output-1.png");

          console.log("PDF convertido em imagem:", imagePath);

          // Retorna como imagem para processamento de visão
          resolve({
            type: "image", // indica que deve ser processado como imagem
            content: imagePath // caminho da imagem gerada
          });
        }
      );
    });
  }

  // ========================================================
  // PROCESSAMENTO DE IMAGENS
  // ========================================================
  // Aceita qualquer tipo de imagem: png, jpg, gif, webp, etc
  if (mimeType.startsWith("image/")) {
    console.log("Arquivo é imagem → enviando para IA de visão");

    return {
      type: "image",
      content: filePath // retorna o caminho temporário da imagem
    };
  }

  // ========================================================
  // PROCESSAMENTO DE ARQUIVOS DE TEXTO
  // ========================================================
  // Qualquer outro tipo de arquivo (txt, csv, js, json, etc)
  console.log("Arquivo é texto/código → lendo conteúdo");

  // Lê o arquivo como texto UTF-8
  const text = fs.readFileSync(filePath, "utf-8");

  return {
    type: "text",
    content: text
  };
}

// ----------------------------------------------------------
// FUNÇÃO AUXILIAR: VERIFICAR SE É IMAGEM
// ----------------------------------------------------------
// Verifica se o arquivo é uma imagem baseado no MIME type
// Útil para validações antes do processamento

function isImageFile(file) {
  return file.mimetype.startsWith("image/");
}

// ----------------------------------------------------------
// EXPORTAÇÃO
// ----------------------------------------------------------
// Exporta as funções para serem usadas em outros arquivos

module.exports = {
  extractFileContent, // função principal de extração
  isImageFile // função auxiliar de verificação
};