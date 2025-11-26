// ======== FinNova Backend (Node.js) ========
// AI การเงินส่วนบุคคล พร้อม RAG + ความจำ + ภาษี
//------------------------------------------------

// โหลด .env
import "dotenv/config";
import express from "express";
import cors from "cors";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { financial_docs } from "./financial_docs.js";
import { pipeline } from "@xenova/transformers";

// ===== Express Setup =====
const app = express();
app.use(cors());
app.use(express.json());

// ===== ENV =====
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const PORT = process.env.PORT || 8000;

if (!GEMINI_API_KEY) {
    console.error("❌ ERROR: ต้องตั้งค่า GEMINI_API_KEY ในไฟล์ .env ก่อนรัน server");
    process.exit(1);
}

// ===== Gemini Setup =====
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// ===== Load Embedding Model =====
console.log("🔁 Loading embeddings model...");
const embedder = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");

// ===== Embedding Adapter for LangChain =====
class XenovaEmbeddings {
    constructor(embedder) {
        this.embedder = embedder;
    }

    async embedDocuments(texts) {
        const vectors = [];
        for (const text of texts) {
            const out = await this.embedder(text);
            vectors.push(out.data[0]);
        }
        return vectors;
    }

    async embedQuery(text) {
        const out = await this.embedder(text);
        return out.data[0];
    }
}

// ===== Split Docs =====
console.log("📄 Splitting knowledge base...");
const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 300,
    chunkOverlap: 50,
});
const docs = await splitter.splitText(financial_docs);

// ===== Vector DB =====
console.log("🧠 Creating Vector Store...");
const vectorStore = await MemoryVectorStore.fromTexts(
    docs,
    docs.map(() => ({})),
    new XenovaEmbeddings(embedder)
);

// ===== Memory =====
let memorySummary = "";
let chatHistory = [];

// ===== Tax Function =====
function calculateTax(salary) {
    const annual = salary * 12;
    const expense = Math.min(annual * 0.5, 100000); // ค่าใช้จ่ายเหมา
    const deduction = 60000; // ค่าลดหย่อนส่วนตัว
    const net = annual - expense - deduction;

    if (net <= 0) return { annual, expense, deduction, net, tax: 0 };

    let tax = 0;
    let remain = net;

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

    for (const [limit, rate] of brackets) {
        if (remain <= 0) break;
        const amt = Math.min(remain, limit);
        tax += amt * rate;
        remain -= amt;
    }

    return { annual, expense, deduction, net, tax };
}

// ===== Persona =====
const PERSONA = `
ชื่อ: FinNova
คาแรคเตอร์: นักวิเคราะห์การเงินที่พูดให้เข้าใจง่าย ไม่เวิ่น ไม่ใช้ศัพท์ยาก
ถนัดเรื่อง: เงินเดือน ภาษี การเงินส่วนบุคคล งบการเงิน
โทนการพูด: เหมือนเพื่อนที่เก่งเรื่องการเงิน อธิบายตรงๆ ฟังแล้วเข้าใจเลย
`;

// ===== Core Chat Engine =====
async function smartChat(input) {
    const match = input.match(/เงินเดือน\s*(\d+)/);
    if (match) {
        const salary = Number(match[1]);
        const { annual, expense, deduction, net, tax } = calculateTax(salary);

        const ans = `คำนวณให้แล้วครับ 📊

💼 รายได้ & รายจ่าย
- เงินเดือนต่อปี: ${annual.toLocaleString()} บาท
- ค่าใช้จ่ายเหมา (50% ของรายได้ สูงสุด 100,000): ${expense.toLocaleString()} บาท
- ค่าลดหย่อนส่วนบุคคล: ${deduction.toLocaleString()} บาท

🧮 เงินได้สุทธิ
= ${annual.toLocaleString()} - ${expense.toLocaleString()} - ${deduction.toLocaleString()}
= ${net.toLocaleString()} บาท

🎯 ผลลัพธ์ภาษี
${tax > 0
                ? `ต้องเสียภาษีจำนวน ${tax.toLocaleString()} บาท`
                : "ไม่ต้องเสียภาษี เพราะเงินได้สุทธิไม่ถึงเกณฑ์"}

📝 อธิบายเพิ่มเติม:
เงินได้สุทธิ = รายได้ต่อปี - ค่าใช้จ่าย - ค่าลดหย่อน`;

        chatHistory.push({ user: input, ai: ans });
        return ans;
    }

    const foundDocs = await vectorStore.similaritySearch(input, 3);
    const context = foundDocs.map((d) => d.pageContent).join("\n");

    const llm = genAI.getGenerativeModel({
        model: "gemini-2.5-flash",
        generationConfig: { temperature: 0.25 },
    });

    const prompt = `
${PERSONA}

ข้อมูลอ้างอิง:
${context}

สรุปก่อนหน้า:
${memorySummary}

คำถาม: ${input}
ตอบแบบเข้าใจง่าย กระชับ ไม่สอนเป็นตำรา
`;

    const result = await llm.generateContent(prompt);
    const ans = result.response.text();

    chatHistory.push({ user: input, ai: ans });

    const mem = await llm.generateContent(
        `สรุปการคุยนี้ 3 บรรทัด:\n${chatHistory
            .map((h) => `U:${h.user}\nA:${h.ai}`)
            .join("\n")}`
    );
    memorySummary = mem.response.text();

    return ans;
}

// ===== Routes =====
app.get("/", (_, res) => res.send("FinNova Backend is running 🚀"));
app.get("/test", (_, res) => res.send("OK"));

app.post("/chat", async (req, res) => {
    const answer = await smartChat(req.body.message);
    res.json({ answer });
});

// ===== Run Server =====
app.listen(PORT, () => {
    console.log(`🚀 FinNova backend running at http://localhost:${PORT}`);
});
