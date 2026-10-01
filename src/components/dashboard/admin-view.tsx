import type { Dictionary } from "@/i18n/ar";
import type { Locale } from "@/i18n/config";
import { formatPrice, mockCourses } from "@/lib/mock-data";
import { Badge, Button, Card, Ltr } from "@/ui";

const orders = [
  { number: "AN-10241", course: 0, amount: 45000, status: "paid" },
  { number: "AN-10240", course: 1, amount: 38000, status: "pending" },
  { number: "AN-10239", course: 3, amount: 27500, status: "refunded" },
  { number: "AN-10238", course: 2, amount: 32000, status: "paid" },
] as const;
const tones = { paid: "success", pending: "warning", refunded: "danger" } as const;

export function AdminView({ t, locale }: { t: Dictionary; locale: Locale }) {
  const a = t.dashboard.admin;
  const queues = [
    { label: a.teacherApplications, count: 3 },
    { label: a.contentReview, count: 5 },
  ];
  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_2fr]">
      <section aria-labelledby="approvals" className="flex flex-col gap-4">
        <h2 id="approvals" className="text-lg font-semibold">
          {a.approvals}
        </h2>
        {queues.map((queue) => (
          <Card key={queue.label} className="flex items-center justify-between gap-3 p-5">
            <span className="font-medium">{queue.label}</span>
            <Badge tone="warning">
              <Ltr>{queue.count}</Ltr>
            </Badge>
          </Card>
        ))}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" disabled>
            {a.manualEnrollment}
          </Button>
          <Button variant="outline" size="sm" disabled>
            {a.reports}
          </Button>
        </div>
      </section>
      <section aria-labelledby="orders">
        <h2 id="orders" className="mb-4 text-lg font-semibold">
          {a.orders}
        </h2>
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-sunken text-fg-2">
              <tr>
                <th scope="col" className="px-4 py-3 text-start font-medium">
                  {a.order}
                </th>
                <th scope="col" className="px-4 py-3 text-start font-medium">
                  {t.courses.title}
                </th>
                <th scope="col" className="px-4 py-3 text-start font-medium">
                  {a.amount}
                </th>
                <th scope="col" className="px-4 py-3 text-start font-medium">
                  {a.status}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {orders.map((order) => (
                <tr key={order.number}>
                  <td className="px-4 py-3">
                    <Ltr>{order.number}</Ltr>
                  </td>
                  <td className="px-4 py-3">
                    <bdi>{mockCourses[order.course]?.title[locale]}</bdi>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <Ltr>{formatPrice(locale, order.amount, t.common.currency)}</Ltr>
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={tones[order.status]}>{a.orderStatuses[order.status]}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </section>
    </div>
  );
}
