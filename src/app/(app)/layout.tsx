import type { ReactNode } from "react";
import { ErrorTextsProvider } from "@/components/shell/error-texts";
import { getDictionary } from "@/i18n/server";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const { t } = await getDictionary();
  return (
    <ErrorTextsProvider texts={{ message: t.errors.retry, retry: t.errors.retryAction }}>
      {children}
    </ErrorTextsProvider>
  );
}
