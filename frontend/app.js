// ====================== CONFIG ======================
const API_BASE =
  window._env_?.API_BASE || "https://finnovaai-backend.onrender.com";

// ====================== DOM ELEMENTS ======================
const chatBox = document.getElementById("chat-box");
const form = document.getElementById("chat-form");
const input = document.getElementById("user-input");

// ====================== LOCAL STORAGE ======================
let chats = [];
try {
  chats = JSON.parse(localStorage.getItem("finnova_chats") || "[]");
} catch {
  chats = [];
}

let currentChatId = null;

// บันทึกลง localStorage
function saveChats() {
  localStorage.setItem("finnova_chats", JSON.stringify(chats));
}

// เก็บ id แชทล่าสุดที่เปิด
function setLastChat(id) {
  if (id == null) {
    localStorage.removeItem("finnova_last_chat");
  } else {
    localStorage.setItem("finnova_last_chat", String(id));
  }
}

// ====================== UI Helpers ======================
function addMessage(text, sender, options = {}) {
  const row = document.createElement("div");
  row.classList.add("message-row", sender);

  if (options.pending) {
    row.classList.add("pending");
  }

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

  // แชทใหม่อยู่บนสุด
  chats.unshift({
    id,
    name: "แชทใหม่",
    messages: [],
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
  const chat = chats.find((c) => c.id === id);
  if (!chat) return;

  currentChatId = id;
  setLastChat(id);

  const titleEl = document.getElementById("chat-title");
  if (titleEl) {
    titleEl.textContent = chat.name;
  }

  chatBox.innerHTML = "";
  chat.messages.forEach((msg) => addMessage(msg.text, msg.sender));
}

function renameChat(id) {
  const chat = chats.find((c) => c.id === id);
  if (!chat) return;

  const newName = prompt("ตั้งชื่อแชทใหม่ : ", chat.name);
  if (!newName) return;

  chat.name = newName.trim() || chat.name;
  saveChats();
  loadChats();

  if (currentChatId === id) {
    const titleEl = document.getElementById("chat-title");
    if (titleEl) {
      titleEl.textContent = chat.name;
    }
  }
}

function deleteChat(id) {
  chats = chats.filter((c) => c.id !== id);
  saveChats();
  loadChats();

  if (currentChatId === id) {
    currentChatId = null;
    setLastChat(null);
    chatBox.innerHTML = "";

    // ถ้ายังมีแชทอื่นอยู่ เปิดอันบนสุดแทน
    if (chats.length > 0) {
      openChat(chats[0].id);
    }
  }
}

// ====================== SEND MESSAGE ======================
async function sendMessage(text) {
  // ถ้ายังไม่มีแชทเลย ให้สร้างก่อน
  if (!currentChatId) {
    createChat();
  }

  const chat = chats.find((c) => c.id === currentChatId);
  if (!chat) return;

  // เพิ่มข้อความฝั่ง user
  addMessage(text, "user");
  chat.messages.push({ text, sender: "user" });
  saveChats();

  // เพิ่ม bubble รอคำตอบ
  const pendingRow = addMessage("กำลังคิดคำตอบให้สักครู่...", "ai", {
    pending: true,
  });

  try {
    const res = await fetch(`${API_BASE}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text }),
    });

    if (!res.ok) {
      throw new Error("HTTP error " + res.status);
    }

    const data = await res.json();
    chatBox.removeChild(pendingRow);

    addMessage(data.answer, "ai");
    chat.messages.push({ text: data.answer, sender: "ai" });
    saveChats();
  } catch (err) {
    console.error(err);
    chatBox.removeChild(pendingRow);
    addMessage("ขออภัย เชื่อมต่อ Backend ไม่ได้ ลองเช็กว่าเซิร์ฟเวอร์รันอยู่หรือไม่", "ai");
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

// ====================== NEW CHAT BUTTON ======================
document.getElementById("new-chat").addEventListener("click", () => {
  createChat();
});

// ====================== INITIAL LOAD ======================
loadChats();

// หลังรีเฟรช ถ้ามี last chat ให้เปิดอันนั้นก่อน
const lastIdRaw = localStorage.getItem("finnova_last_chat");
if (lastIdRaw) {
  const lastId = Number(lastIdRaw);
  const exists = chats.find((c) => c.id === lastId);
  if (exists) {
    openChat(lastId);
  } else if (chats.length > 0) {
    openChat(chats[0].id);
  }
} else if (chats.length > 0) {
  // ไม่มี last chat แต่มีแชทในระบบ → เปิดอันบนสุด
  openChat(chats[0].id);
}
