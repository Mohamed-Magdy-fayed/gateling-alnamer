import { redirect } from "next/navigation";
import { getDictionary } from "@/i18n/server";
import { getPreSession } from "@/server/devices/pre-session";
import { Container } from "@/ui";

/** Placeholder that only proves the pre-session is accepted here; A5.4 replaces it with the real screen. */
export default async function DevicesBlockedPage() {
  const pre = await getPreSession();
  if (!pre) redirect("/sign-in");
  const { t } = await getDictionary();
  return (
    <Container className="py-8">
      <h1 className="text-xl font-bold">{t.devices.blockedTitle}</h1>
    </Container>
  );
}
