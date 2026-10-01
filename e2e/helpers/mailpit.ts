// Reads mail from the local Mailpit API (docker-compose `mailpit`, UI/API on 8025).
const MAILPIT_URL = process.env.MAILPIT_URL ?? "http://localhost:8025";
const POLL_INTERVAL_MS = 250;
const POLL_TIMEOUT_MS = 15_000;

interface MailpitSearch {
  messages?: { ID: string }[];
}

interface MailpitMessage {
  Text: string;
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${MAILPIT_URL}${path}`);
  if (!response.ok) throw new Error(`Mailpit ${path} answered ${response.status}`);
  return (await response.json()) as T;
}

/** Waits for the newest message sent to `email` and returns its plain-text body. */
export async function waitForMailText(email: string): Promise<string> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const found = await getJson<MailpitSearch>(
      `/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
    );
    const id = found.messages?.[0]?.ID;
    if (id) return (await getJson<MailpitMessage>(`/api/v1/message/${id}`)).Text;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error(`No mail for ${email} reached Mailpit within ${POLL_TIMEOUT_MS} ms`);
}

/** The 6-digit password-reset code in a mail body. */
export function extractCode(text: string): string {
  const match = text.match(/\b(\d{6})\b/);
  if (!match?.[1]) throw new Error("No 6-digit code found in the mail body");
  return match[1];
}
