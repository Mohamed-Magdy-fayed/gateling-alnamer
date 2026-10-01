import "server-only";
import nodemailer from "nodemailer";
import { isDeployed, serverEnv } from "@/server/env";

type Mail = { to: string; subject: string; text: string; html: string };

export async function sendMail(mail: Mail): Promise<void> {
  const env = serverEnv();
  if (!env.SMTP_HOST || !env.SMTP_FROM_EMAIL) {
    if (isDeployed()) throw new Error("SMTP is not configured on this deployment.");
    // Local development without SMTP: print the message so the flow can be tested.
    console.info(`[dev mail] to=${mail.to} subject=${mail.subject}\n${mail.text}`);
    return;
  }
  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT ?? 587,
    secure: (env.SMTP_PORT ?? 587) === 465,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
  });
  await transport.sendMail({
    from: { name: env.SMTP_FROM_NAME ?? "Al-Namer", address: env.SMTP_FROM_EMAIL },
    ...mail,
  });
}
