import { encryptionMiddleware } from "@inngest/middleware-encryption";
import { Inngest } from "inngest";

// Event payloads sit under `data.encrypted` (see events.ts). The env schema requires the key when
// APP_MODE=live; in demo it is optional, so the middleware is only attached when a key is present.
const encryptionKey = process.env.INNGEST_ENCRYPTION_KEY?.trim();

export const inngest = new Inngest({
  id: "al-namer",
  middleware: encryptionKey ? [encryptionMiddleware({ key: encryptionKey })] : [],
});
