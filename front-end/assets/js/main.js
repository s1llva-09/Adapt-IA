function getInitialHistory() {
  return [
    {
      role: "assistant",
      content:
        "Olá! Me diga sobre qual assunto você quer conversar e eu vou me adaptar ao contexto."
    }
  ];
}

function redirectToBackendChat(provider, history) {
  const hostname = window.location.hostname || "127.0.0.1";

  window.name = JSON.stringify({
    adaptIaTransfer: {
      provider,
      chatHistory: history
    }
  });

  window.location.href = `http://${hostname}:3000/chat.html`;
}

function selectProvider(provider) {
  const initialHistory = getInitialHistory();

  if (
    window.location.protocol.startsWith("http") &&
    window.location.port !== "3000"
  ) {
    redirectToBackendChat(provider, initialHistory);
    return;
  }

  localStorage.setItem("provider", provider);
  localStorage.setItem("chatHistory", JSON.stringify(initialHistory));
  window.location.href = "chat.html";
}

window.selectProvider = selectProvider;
