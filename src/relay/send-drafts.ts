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

async function main() {
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

  try {
    const draftsMailbox = await findDraftsMailbox(imapClient);
    const lock = await imapClient.getMailboxLock(draftsMailbox);

    try {
      if (imapClient.mailbox === false || imapClient.mailbox.exists === 0) {
        console.log("ไม่มี draft ใหม่ให้ส่ง");
        return;
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

        console.log(`ส่งสำเร็จ: ${subject}`);
        sentUids.push(message.uid);
      }

      if (sentUids.length > 0) {
        await imapClient.messageDelete(sentUids, { uid: true });
        console.log(`ลบ draft ที่ส่งแล้วออก ${sentUids.length} ฉบับ`);
      } else {
        console.log("ไม่มี draft ใหม่ให้ส่ง");
      }
    } finally {
      lock.release();
    }
  } finally {
    await imapClient.logout();
  }
}

main().catch((error) => {
  console.error("เกิดข้อผิดพลาด:", error);
  process.exit(1);
});
