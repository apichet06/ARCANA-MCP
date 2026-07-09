import "dotenv/config";
import cors from "cors";
import express from "express";
import { sendDrafts } from "./relay/send-drafts.js";

const app = express();
app.use(cors());

app.get("/relay/send-drafts", async (req, res) => {
  const secret = process.env.RELAY_SECRET ?? "";

  if (!secret || req.query.token !== secret) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  try {
    const { sentSubjects } = await sendDrafts();
    res.json({ sent: sentSubjects.length, subjects: sentSubjects });
  } catch (error) {
    console.error("เกิดข้อผิดพลาด:", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "unknown error" });
  }
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`Arcana MCP server listening on port ${port}`);
});
