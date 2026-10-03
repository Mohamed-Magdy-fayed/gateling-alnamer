import { CreditCard } from "lucide-react";
import { notFound } from "next/navigation";
import { getDictionary } from "@/i18n/server";
import { formatPrice } from "@/lib/money-format";
import { getHostedInvoice } from "@/server/payments/mock";
import { Alert, Card, Container, Ltr } from "@/ui";
import { SubmitButton } from "@/ui/submit-button";
import { failInvoiceAction, payInvoiceAction } from "./actions";
import { isMockInvoiceId } from "./invoice-id";

/** The mock gateway's hosted payment page (demo only: the `/dev` layout 404s elsewhere). */
export default async function DevPayPage({ params }: { params: Promise<{ invoiceId: string }> }) {
  const { invoiceId } = await params;
  if (!isMockInvoiceId(invoiceId)) notFound();
  const invoice = await getHostedInvoice(invoiceId);
  if (!invoice) notFound();
  const { t, locale } = await getDictionary();
  const d = t.orders.devPay;
  const payable = invoice.status === "pending";

  return (
    <Container className="py-12">
      <div className="mx-auto flex max-w-md flex-col gap-4">
        <Alert tone="warning">{d.banner}</Alert>
        <Card className="flex flex-col gap-5 p-6">
          <h1 className="flex items-center gap-2 text-xl font-bold">
            <CreditCard aria-hidden className="size-5 text-fg-muted" strokeWidth={1.75} />
            {d.title}
          </h1>
          <div className="flex flex-col gap-1">
            <p className="text-sm text-fg-muted">{d.amountLabel}</p>
            <p className="text-3xl font-bold">
              <Ltr>{formatPrice(locale, invoice.amountMinor, invoice.currency)}</Ltr>
            </p>
            <p className="text-xs text-fg-muted">
              <Ltr>{invoice.id}</Ltr>
            </p>
          </div>
          {payable ? (
            <div className="flex flex-col gap-2">
              <form action={payInvoiceAction.bind(null, invoice.id)}>
                <SubmitButton className="w-full">{d.pay}</SubmitButton>
              </form>
              <form action={failInvoiceAction.bind(null, invoice.id)}>
                <SubmitButton variant="secondary" className="w-full">
                  {d.fail}
                </SubmitButton>
              </form>
            </div>
          ) : (
            <Alert tone="danger">{d.invalid}</Alert>
          )}
        </Card>
      </div>
    </Container>
  );
}
