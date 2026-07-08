import "dotenv/config";
import { generateDailyContent } from "./content/generate-content.js";
import { sendMail } from "./mailler/mail-utils.js";

async function main() {
  const content = await generateDailyContent();

  const result = await sendMail({
    to: process.env.SENT_MAIL ?? "",
    subject: content.subject,
    html: content.htmlBody,
  });

  if (result.success) {
    console.log("ส่งอีเมลสำเร็จ:", result.messageId);
  } else {
    console.error("ส่งอีเมลล้มเหลว:", result.error);
  }
}

main();
