// โหลด ENV
import "dotenv/config";
import express from "express";
import cors from "cors";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { financial_docs } from "./financial_docs.js";
import { pipeline } from "@xenova/transformers";

// ===== EXPRESS CONFIG =====
const app = express();
app.use(cors());
app.use(express.json());

// ===== ENV VARIABLES =====
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const PORT = process.env.PORT || 8000;

if (!GEMINI_API_KEY) {
    console.error("❌ ERROR: ต้องตั้งค่า GEMINI_API_KEY ในไฟล์ .env ก่อนรัน server");
    process.exit(1);
}

// ===== LLM Engine =====
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// ===== LOAD EMBEDDING MODEL =====
console.log("🔁 Loading embeddings model...");
const embedder = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");

// Adapter ให้ LangChain ใช้งาน
class XenovaEmbeddings {
    constructor(model) {
        this.model = model;
    }
    async embedDocuments(texts) {
        const out = [];
        for (const t of texts) {
            const v = await this.model(t);
            out.push(v.data[0]);
        }
        return out;
    }
    async embedQuery(text) {
        const v = await this.model(text);
        return v.data[0];
    }
}

// ===== SPLIT KNOWLEDGE BASE =====
console.log("📄 Splitting knowledge base...");
const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 300,
    chunkOverlap: 50,
});
const docs = await splitter.splitText(financial_docs);

// ===== CREATE VECTOR DATABASE =====
console.log("🧠 Creating Vector Store...");
const vectorStore = await MemoryVectorStore.fromTexts(
    docs,
    docs.map(() => ({})),
    new XenovaEmbeddings(embedder)
);

// ===== MEMORY =====
let memorySummary = "";
let chatHistory = [];

// ===== TAX CALCULATOR =====
function calculateTax(salary) {
    const annual = salary * 12;
    const expense = Math.min(annual * 0.5, 100000);
    const deduction = 60000;
    const net = annual - expense - deduction;

    if (net <= 0) return { annual, expense, deduction, net, tax: 0 };

    const brackets = [
        [150000, 0],
        [150000, 0.05],
        [200000, 0.1],
        [250000, 0.15],
        [250000, 0.2],
        [1000000, 0.25],
        [3000000, 0.3],
        [Infinity, 0.35],
    ];

    let tax = 0, remain = net;
    for (const [limit, rate] of brackets) {
        const amt = Math.min(remain, limit);
        tax += amt * rate;
        remain -= amt;
        if (remain <= 0) break;
    }

    return { annual, expense, deduction, net, tax };
}

// ===== Persona =====
const PERSONA = `
ชื่อ: FinNova
คาแรคเตอร์: นักวิเคราะห์การเงินที่พูดเข้าใจง่าย ไม่สอนแบบตำรา
ถนัด: ภาษี เงินเดือน การเงินส่วนบุคคล งบการเงิน
โทน: เพื่อนที่เก่งเรื่องการเงิน อธิบายสั้น เคลียร์ ตรงประเด็น
`;

// ===== CORE CHAT ENGINE =====
async function smartChat(input) {
    // ตรวจจับข้อความ "เงินเดือนxxxx"
    const match = input.match(/เงินเดือน\s*(\d+)/);
    if (match) {
        const salary = Number(match[1]);
        const { annual, expense, deduction, net, tax } = calculateTax(salary);

        const ans = `
คำนวณภาษีเงินได้บุคคลธรรมดาให้แล้วครับ 📊
(ผลการคำนวณนี้เป็นการประเมินเบื้องต้น หากมีค่าลดหย่อนอื่นเพิ่มเติม ผลลัพธ์อาจเปลี่ยนแปลงได้)

💼 รายได้ต่อปี : ${annual.toLocaleString()} บาท
💸 ค่าใช้จ่ายเหมา : ${expense.toLocaleString()} บาท
🧾 ค่าลดหย่อนส่วนตัว : ${deduction.toLocaleString()} บาท
🟦 เงินได้สุทธิ : ${net.toLocaleString()} บาท

${tax > 0
                ? `💰 ต้องเสียภาษี: ${tax.toLocaleString()} บาท`
                : "🎉 ไม่ต้องเสียภาษีครับ"}

เงินได้สุทธิ = รายได้ - ค่าใช้จ่าย - ค่าลดหย่อน
`.trim();

        chatHistory.push({ user: input, ai: ans });
        return ans;
    }

    // ===== RAG SEARCH =====
    const found = await vectorStore.similaritySearch(input, 3);
    const context = found.map((d) => d.pageContent).join("\n");

    const llm = genAI.getGenerativeModel({
        model: "gemini-2.0-flash",
        generationConfig: { temperature: 0.25 },
    });

    const prompt = `
${PERSONA}

ข้อมูลอ้างอิง:
${context}

สรุปบทสนทนาก่อนหน้า:
${memorySummary}

คำถาม: ${input}
ตอบแบบเข้าใจง่าย กระชับ ไม่ใช้ศัพท์เทคนิคเกินไป
`.trim();

    const result = await llm.generateContent(prompt);
    const answer = result.response.text();

    chatHistory.push({ user: input, ai: answer });

    // อัปเดต memory summary
    const mem = await llm.generateContent(
        `สรุปความคุยนี้ 3 บรรทัด:\n${chatHistory
            .map((h) => `U:${h.user}\nA:${h.ai}`)
            .join("\n")}`
    );
    memorySummary = mem.response.text();

    return answer;
}

// ===== ROUTES =====
app.get("/", (_, res) => res.send("FinNova Backend is running 🚀"));

app.post("/chat", async (req, res) => {
    const answer = await smartChat(req.body.message);
    res.json({ answer });
});

// ===== START SERVER =====
app.listen(PORT, () => {
    console.log(`🚀 FinNova backend running at http://localhost:${PORT}`);
});
