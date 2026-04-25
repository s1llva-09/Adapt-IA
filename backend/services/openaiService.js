const OpenAI = require("openai");

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

async function sendToOpenAI(messages) {
  const response = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages
  });

  return response.choices[0].message.content;
}

module.exports = { sendToOpenAI };
