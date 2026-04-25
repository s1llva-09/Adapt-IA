//Multer é um middleware do Node.js (Express) usado para:
    //receber arquivos enviados pelo front-end

const fs = require("fs") //um modulo para conseguir ler arquivos, escrever, apagar etc
const path = require("path") //ajuda a trabalhar com caminhos de arquivos Exemplo: pegar pfd de arquivo .pdf
const mammoth = require("mammoth") //biblioca para extrair o texto de arquivos txt(word) em geral
const pdfParse = require("pdf-Parse") //biblioteca para extrair textos de arquivos pdf

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

// Verifica se o arquivo é imagem
function isImageFile(file) {
  const ext = path.extname(file.originalname).toLowerCase();
  return IMAGE_EXTENSIONS.includes(ext);
}

//função para ler o arquivo recebido
async function extractFileContent(file) {
    //pega a extensão do arquivo , ex: document.pdf vira .pdf

                                               //trata o PDF e pdf como a mesma coisa 
    const ext = path.extname(file.originalname).toLowerCase()

    //lista de arquivos que podem ser lidos direto como texto
    // Isso funciona para código, markdown, JSON, CSV, etc.
    if(TEXT_EXTENSIONS.includes(ext)) {
        //Lê o conteúdo do arquivo como texto UTF-8.
        //file.path é onde o multer salvou o arquivo
        return fs.readFileSync(file.path, "utf8");
    }

    //se for arquivo .docx, usa o mammoth
    if (ext == ".docx") {
    // extractRawText extrai apenas o texto bruto do documento.
    // Não mantém estilos, imagens ou formatação avançada.

    const result = await mammoth.extractRawText({
        path: file.path
    })
    // result.value contém o texto extraído do documento.
    return result.value
    }

    //se o arquivo for pdf, usa o pdf-parse
    if (ext == ".pdf") {
        //primeiro o pdf é lido com buffer
        const buffer = fs.readFileSync(file.path)

        //depois o bufferr passa para o pdf-parse
        const result = await pdfParse(buffer)

        //result.text mostra o texto extraido do pdf
        return result.text
    }

    return `Arquivo recebido: ${file.originalname} , mas esse tipo ainda nao tem extração configurada`
}

module.exports = {
    extractFileContent, isImageFile
}