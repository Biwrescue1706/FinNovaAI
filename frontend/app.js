// ====================== CONFIG ======================
const API_BASE = "https://finnovaai-backend.onrender.com";

const chatBox = document.getElementById("chat-box");
const form = document.getElementById("chat-form");
const input = document.getElementById("user-input");

// ====================== LOCAL STORAGE ======================
let chats = JSON.parse(localStorage.getItem("finnova_chats") || "[]");
let currentChatId = null;

// บันทึกลง localStorage
function saveChats() {
  localStorage.setItem("finnova_chats", JSON.stringify(chats));
}

// ====================== UI Helpers ======================
function addMessage(text, sender, options = {}) {
  const row = document.createElement("div");
  row.classList.add("message-row", sender);

  if (options.pending) row.classList.add("pending");

  const bubble = document.createElement("div");
  bubble.classList.add("message-bubble");

  const displayName = sender === "user" ? "คุณ" : "FinNova";
  bubble.innerHTML = `<strong>${displayName}:</strong> ${text}`;

  row.appendChild(bubble);
  chatBox.appendChild(row);
  chatBox.scrollTop = chatBox.scrollHeight;

  return row;
}

// ====================== CHAT CONTROL ======================
function createChat() {
  const id = Date.now();

  chats.unshift({
    id,
    name: `แชทใหม่`,
    messages: [
      {
        text: "สวัสดีครับ! มาเลย มีอะไรอยากรู้เรื่องเงินๆ ทองๆ ถามมาได้เลยนะ",
        sender: "ai",
      },
    ],
  });

  saveChats();
  loadChats();
  openChat(id);
}

function loadChats() {
  const list = document.getElementById("chat-list");
  list.innerHTML = "";

  chats.forEach((chat) => {
    const li = document.createElement("li");
    li.className = "chat-item";
    li.innerHTML = `
      <span onclick="openChat(${chat.id})">${chat.name}</span>
      <span class="chat-actions">
        <button onclick="renameChat(${chat.id})">✏</button>
        <button onclick="deleteChat(${chat.id})">🗑</button>
      </span>
    `;
    list.appendChild(li);
  });
}

function openChat(id) {
  currentChatId = id;
  const chat = chats.find((c) => c.id === id);
  document.getElementById("chat-title").textContent = chat.name;
  chatBox.innerHTML = "";
  chat.messages.forEach((msg) => addMessage(msg.text, msg.sender));
}

function renameChat(id) {
  const chat = chats.find((c) => c.id === id);
  const newName = prompt("ตั้งชื่อแชทใหม่:", chat.name);
  if (!newName) return;

  chat.name = newName.trim();
  saveChats();
  loadChats();
  document.getElementById("chat-title").textContent = chat.name;
}

function deleteChat(id) {
  chats = chats.filter((c) => c.id !== id);
  saveChats();
  loadChats();
  chatBox.innerHTML = "";
  currentChatId = null;
}

// ====================== SEND MESSAGE ======================
async function sendMessage(text) {
  if (!currentChatId) createChat();

  const chat = chats.find((c) => c.id === currentChatId);

  // user bubble
  addMessage(text, "user");
  chat.messages.push({ text, sender: "user" });
  saveChats();

  // ai pending
  const pendingRow = addMessage("กำลังคิดคำตอบให้สักครู่...", "ai", { pending: true });

  try {
    const res = await fetch(`${API_BASE}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text }),
    });

    const data = await res.json();
    chatBox.removeChild(pendingRow);

    addMessage(data.answer, "ai");
    chat.messages.push({ text: data.answer, sender: "ai" });
    saveChats();
  } catch (err) {
    chatBox.removeChild(pendingRow);
    addMessage("❌ ไม่สามารถเชื่อมต่อ Backend ได้", "ai");
  }
}

// ====================== FORM EVENT ======================
form.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  sendMessage(text);
});

// ====================== BIND NEW CHAT BUTTON ======================
document.getElementById("new-chat").addEventListener("click", createChat);

// โหลดแชทเมื่อเปิดเว็บ
loadChats();
