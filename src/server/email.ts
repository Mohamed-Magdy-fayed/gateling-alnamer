import "server-only";
import nodemailer from "nodemailer";
import { isDeployed, serverEnv } from "@/server/env";

type Mail = { to: string; subject: string; text: string; html: string };

const MAILPIT_HOST = "localhost";
const MAILPIT_PORT = 1025;
const DEFAULT_FROM_EMAIL = "noreply@alnamer.local";

function logToConsole(mail: Mail): void {
  console.info(`[dev mail] to=${mail.to} subject=${mail.subject}\n${mail.text}`);
}

export async function sendMail(mail: Mail): Promise<void> {
  const env = serverEnv();
  const { email, emailIsDefault } = env.providers;

  if (email === "mailpit") {
    if (isDeployed()) throw new Error("SMTP is not configured on this deployment.");
    const transport = nodemailer.createTransport({ host: MAILPIT_HOST, port: MAILPIT_PORT });
    try {
      await transport.sendMail({
        from: {
          name: env.SMTP_FROM_NAME ?? "Al-Namer",
          address: env.SMTP_FROM_EMAIL ?? DEFAULT_FROM_EMAIL,
        },
        ...mail,
      });
    } catch (error: unknown) {
      // Nothing was configured and Mailpit is not running: print so the flow can still be tested.
      if (!emailIsDefault) throw error;
      logToConsole(mail);
    }
    return;
  }

  if (!env.SMTP_HOST || !env.SMTP_FROM_EMAIL) {
    // Local demo without a configured sender: print so the flow can still be tested.
    if (env.APP_MODE === "demo" && !isDeployed()) {
      logToConsole(mail);
      return;
    }
    throw new Error("SMTP_HOST and SMTP_FROM_EMAIL are required when EMAIL_TRANSPORT=smtp.");
  }
  const port = env.SMTP_PORT ?? 587;
  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
  });
  await transport.sendMail({
    from: { name: env.SMTP_FROM_NAME ?? "Al-Namer", address: env.SMTP_FROM_EMAIL },
    ...mail,
  });
}
