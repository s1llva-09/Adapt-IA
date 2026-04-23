const OpenAI = require('openai')

const client = new OpenAI({ //cria uma instância do cliente OpenAI usando a chave de API armazenada na variável de ambiente OPENAI_API_KEY
    apiKey: process.env.OPENAI_API_KEY //a chave de API é necessária para autenticar as requisições feitas para a API da OpenAI, garantindo que apenas usuários autorizados possam acessar os serviços oferecidos pela plataforma.
})

async function sendToOpenAI(messages) { //função assíncrona que recebe um array de mensagens e envia para a API da OpenAI para obter uma resposta da IA
    const response = await client.chat.completions.create({ //chama o método create do endpoint chat.completions do cliente OpenAI para criar uma nova conclusão de chat, passando um objeto com as mensagens e o modelo a ser usado
        model: "gpt-4o-mini", //modelo usado pela IA para gerar a resposta. O modelo gpt-4o-mini é uma versão otimizada do GPT-4, projetada para oferecer um bom equilíbrio entre desempenho e custo, sendo adequada para aplicações que exigem respostas rápidas e eficientes.
        messages
    })

    return response.choices[0].messages.content //retorna o conteúdo da resposta da IA, que está localizado na primeira escolha (choices[0]) e dentro do campo messages.content
}

module.exports = { sendToOpenAI } //exporta a função sendToOpenAI para que ela possa ser usada em outros arquivos, como o backend/server.js, onde é chamada para obter a resposta da IA quando o provider escolhido é "openai".