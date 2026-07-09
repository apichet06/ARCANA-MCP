import "dotenv/config";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import nodemailer from "nodemailer";

const IMAP_HOST = "imap.gmail.com";
const IMAP_PORT = 993;

async function findDraftsMailbox(client: ImapFlow): Promise<string> {
  const mailboxes = await client.list();
  const drafts = mailboxes.find((box) => box.specialUse === "\\Drafts");
  if (!drafts) {
    throw new Error("ไม่พบโฟลเดอร์ Drafts ในบัญชี Gmail นี้");
  }
  return drafts.path;
}

async function uidsStillPresent(client: ImapFlow, uids: number[]): Promise<number[]> {
  const found: number[] = [];
  for await (const message of client.fetch(uids.join(","), {}, { uid: true })) {
    found.push(message.uid);
  }
  return found;
}

export async function sendDrafts(): Promise<{ sentSubjects: string[] }> {
  const user = process.env.SMTP_USER ?? "";
  const pass = process.env.SMTP_PASS ?? "";
  const to = process.env.SENT_MAIL ?? "";

  if (!user || !pass || !to) {
    throw new Error("ตั้งค่า SMTP_USER, SMTP_PASS, SENT_MAIL ใน .env ให้ครบก่อน");
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: { user, pass },
  });

  const imapClient = new ImapFlow({
    host: IMAP_HOST,
    port: IMAP_PORT,
    secure: true,
    auth: { user, pass },
    logger: false,
  });

  await imapClient.connect();

  const sentSubjects: string[] = [];

  try {
    const draftsMailbox = await findDraftsMailbox(imapClient);
    const lock = await imapClient.getMailboxLock(draftsMailbox);

    try {
      if (imapClient.mailbox === false || imapClient.mailbox.exists === 0) {
        return { sentSubjects };
      }

      const sentUids: number[] = [];

      for await (const message of imapClient.fetch("1:*", { source: true, envelope: true })) {
        if (!message.source) continue;

        const parsed = await simpleParser(message.source);
        const subject = parsed.subject ?? "(ไม่มีหัวข้อ)";
        const html = parsed.html || parsed.textAsHtml || parsed.text || "";

        await transporter.sendMail({
          from: `"${process.env.FROM_NAME ?? "Arcana"}" <${user}>`,
          to,
          subject,
          html,
        });

        sentSubjects.push(subject);
        sentUids.push(message.uid);
      }

      if (sentUids.length > 0) {
        const mailboxes = await imapClient.list();
        const trash = mailboxes.find((box) => box.specialUse === "\\Trash");
        if (!trash) {
          throw new Error("ไม่พบโฟลเดอร์ Trash ในบัญชี Gmail นี้");
        }
        // Gmail's IMAP treats a plain \Deleted + EXPUNGE on the Drafts label as an
        // archive, not a real delete -- the draft resurfaces later. Moving it to
        // Trash is the only way that reliably removes it from Drafts. The move
        // itself has been observed to silently no-op on Gmail's end once in a
        // while, so verify it actually left Drafts and retry once before giving up.
        await imapClient.messageMove(sentUids, trash.path, { uid: true });

        let remaining = await uidsStillPresent(imapClient, sentUids);
        if (remaining.length > 0) {
          await imapClient.messageMove(remaining, trash.path, { uid: true });
          remaining = await uidsStillPresent(imapClient, remaining);
        }

        if (remaining.length > 0) {
          throw new Error(
            `ส่งอีเมลสำเร็จแล้ว แต่ย้าย draft UID ${remaining.join(", ")} ไป Trash ไม่สำเร็จ ต้องลบด้วยมือ ไม่งั้นจะถูกส่งซ้ำในรอบถัดไป`,
          );
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    await imapClient.logout();
  }

  return { sentSubjects };
}

async function main() {
  const { sentSubjects } = await sendDrafts();

  if (sentSubjects.length === 0) {
    console.log("ไม่มี draft ใหม่ให้ส่ง");
    return;
  }

  for (const subject of sentSubjects) {
    console.log(`ส่งสำเร็จ: ${subject}`);
  }
  console.log(`ลบ draft ที่ส่งแล้วออก ${sentSubjects.length} ฉบับ`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error("เกิดข้อผิดพลาด:", error);
    process.exit(1);
  });
}
