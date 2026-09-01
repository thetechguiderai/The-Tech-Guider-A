const fs = require('fs');
const path = 'C:\\Users\\madik\\Downloads\\The Tech Guider AI\\Public\\script.js';
let s = fs.readFileSync(path, 'utf8');
const start = s.indexOf('async function sendMessage(){');
const end = s.indexOf('async function shareConversation(){');
if (start === -1 || end === -1) {
  throw new Error('Target function block not found.');
}
const replacement = `async function sendMessage(){
  let text = composerInput.value.trim();
  if (!text || sending) return;
  if (attachedText) {
    text = "Attached file: " + attachedName + "\n\n```\n" + attachedText + "\n```\n\n" + text;
    attachedText = attachedName = null;
    attachedFileTag.hidden = true;
    fileInput.value = "";
  }
  composerInput.value = "";
  composerInput.style.height = "auto";
  appendMessage("user", text);

  sending = true;
  sendBtn.disabled = true;
  const pending = appendMessage("assistant", "Thinking…");

  try {
    const endpoint = imageMode ? "/api/image/generate" : "/api/chat";
    const payload = imageMode ? { prompt: text } : { message: text, modelId: modelSelect.value, conversationId: currentConversationId };
    const data = await api(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (imageMode) {
      pending.lastElementChild.textContent = "";
      const img = new Image();
      img.src = data.url;
      img.alt = text;
      img.className = "generated-image";
      pending.lastElementChild.append(img);
    } else {
      pending.lastElementChild.textContent = data.reply || "No response returned.";
      if (data.conversationId && !currentConversationId) {
        currentConversationId = data.conversationId;
        history.replaceState({}, "", "./chat.html?c=" + data.conversationId);
        await loadHistory();
        setTitle((conversations.find(c => c.id === currentConversationId) || {}).title || text.slice(0, 50));
      }
      await loadUsage();
    }
  } catch (error) {
    pending.classList.add("error");
    pending.lastElementChild.textContent = error?.message || "Something went wrong. Please try again.";
    console.error("Chat send failed:", error);
  } finally {
    sending = false;
    sendBtn.disabled = false;
  }
}
`;
s = s.slice(0, start) + replacement + s.slice(end);
fs.writeFileSync(path, s);
console.log('patched');
