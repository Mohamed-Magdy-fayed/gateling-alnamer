// Reads mail from the local Mailpit API (docker-compose `mailpit`, UI/API on 8025).
const MAILPIT_URL = process.env.MAILPIT_URL ?? "http://localhost:8025";
const POLL_INTERVAL_MS = 250;
const POLL_TIMEOUT_MS = 15_000;

interface MailpitSearch {
  messages_count?: number;
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

function search(email: string): Promise<MailpitSearch> {
  return getJson<MailpitSearch>(`/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`);
}

/** How many messages to `email` Mailpit holds now; pass it as `after` to wait for the next one. */
export async function countMail(email: string): Promise<number> {
  const found = await search(email);
  return found.messages_count ?? found.messages?.length ?? 0;
}

/**
 * Waits for the newest message sent to `email` and returns its plain-text body. With `after`, waits
 * until more than that many messages exist, so an older mail (a sign-up code) is never returned
 * in place of the one being waited for.
 */
export async function waitForMailText(
  email: string,
  { after = 0 }: { after?: number } = {},
): Promise<string> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const found = await search(email);
    const count = found.messages_count ?? found.messages?.length ?? 0;
    const id = found.messages?.[0]?.ID;
    if (id && count > after) return (await getJson<MailpitMessage>(`/api/v1/message/${id}`)).Text;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error(`No mail for ${email} reached Mailpit within ${POLL_TIMEOUT_MS} ms`);
}

/** The 6-digit code in a mail body. */
export function extractCode(text: string): string {
  const match = text.match(/\b(\d{6})\b/);
  if (!match?.[1]) throw new Error("No 6-digit code found in the mail body");
  return match[1];
}
