import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KNOWLEDGE_DIR = path.join(__dirname, "..", "knowledge");
const HISTORY_FILE = path.join(__dirname, "..", "..", "data", "content-history.log");
const HISTORY_LIMIT = 14;

const client = new Anthropic();

export interface GeneratedContent {
  subject: string;
  htmlBody: string;
}

interface ContentResponse {
  subject: string;
  topic_summary: string;
  html_body: string;
}

function loadKnowledgeBase(): string {
  const files = fs.readdirSync(KNOWLEDGE_DIR).filter((file) => file.endsWith(".md"));
  return files
    .sort()
    .map((file) => fs.readFileSync(path.join(KNOWLEDGE_DIR, file), "utf-8"))
    .join("\n\n---\n\n");
}

function loadRecentHistory(): string[] {
  if (!fs.existsSync(HISTORY_FILE)) return [];
  const lines = fs
    .readFileSync(HISTORY_FILE, "utf-8")
    .trim()
    .split("\n")
    .filter(Boolean);
  return lines.slice(-HISTORY_LIMIT);
}

function appendHistory(topicSummary: string): void {
  fs.mkdirSync(path.dirname(HISTORY_FILE), { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  fs.appendFileSync(HISTORY_FILE, `${date} | ${topicSummary}\n`, "utf-8");
}

export async function generateDailyContent(): Promise<GeneratedContent> {
  const knowledgeBase = loadKnowledgeBase();
  const recentHistory = loadRecentHistory();

  const historySection =
    recentHistory.length > 0
      ? `หัวข้อที่เคยเขียนไปแล้วล่าสุด (ห้ามซ้ำ ให้เลือกสินค้า/มุมมองใหม่ หรือพัฒนาต่อยอดให้ลึกและน่าสนใจกว่าเดิม):\n${recentHistory.join("\n")}`
      : "ยังไม่เคยมีการเขียน content มาก่อน เริ่มได้เลย";

  const response = await client.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 4096,
    thinking: { type: "adaptive" },
    output_config: {
      effort: "high",
      format: {
        type: "json_schema",
        schema: {
          type: "object",
          properties: {
            subject: {
              type: "string",
              description: "หัวข้ออีเมล กระชับ น่าสนใจ ตรงกับ tone of voice ของแบรนด์",
            },
            topic_summary: {
              type: "string",
              description:
                "สรุปสั้น ๆ 1 บรรทัดว่า content ชิ้นนี้พูดถึงสินค้า/ประเด็นอะไร (ใช้กันเขียนซ้ำในอนาคต)",
            },
            html_body: {
              type: "string",
              description: "เนื้อหา content เต็มรูปแบบเป็น HTML พร้อมส่งเป็นอีเมล",
            },
          },
          required: ["subject", "topic_summary", "html_body"],
          additionalProperties: false,
        },
      },
    },
    system: `คุณคือนักเขียนคอนเทนต์การตลาดของแบรนด์ ARCANA ให้ยึดความรู้ต่อไปนี้เป็นฐานในการเขียนทุกครั้งอย่างเคร่งครัด (brand voice, สินค้า, writing style, SEO guideline):\n\n${knowledgeBase}`,
    messages: [
      {
        role: "user",
        content: `${historySection}\n\nช่วยคิด content การตลาดสำหรับวันนี้ 1 ชิ้น ตามหลัก Problem → Empathy → Education → Product → Benefit → Trust → CTA โดยต้องดีขึ้นและน่าสนใจกว่าที่เคยเขียนมา`,
      },
    ],
  });

  const textBlock = response.content.find((block) => block.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Claude ไม่ได้ตอบกลับเป็นข้อความ");
  }

  const parsed = JSON.parse(textBlock.text) as ContentResponse;
  appendHistory(parsed.topic_summary);

  return { subject: parsed.subject, htmlBody: parsed.html_body };
}
