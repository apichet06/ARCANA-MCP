import { transporter } from "./mail-config.js";
import type { MailOptions, SendMailResult } from "./type.js";

export async function sendMail(options: MailOptions): Promise<SendMailResult> {
  try {
    const info = await transporter.sendMail({
      from: `"${process.env.FROM_NAME ?? "Arcana"}" <${process.env.SMTP_USER}>`,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
    });
    return { success: true, messageId: info.messageId };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
