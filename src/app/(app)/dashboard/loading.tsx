import { Skeleton } from "@/components/ui/skeleton";
import { Card, Container } from "@/ui";

/** Landing shape while the page loads: title block, then two cards. The shell is already on screen. */
export default function DashboardLoading() {
  return (
    <Container className="py-8" aria-busy="true">
      <Skeleton className="h-8 w-56 max-w-full" />
      <Skeleton className="mt-2 h-4 w-40 max-w-full" />
      <div className="mt-8 grid gap-4 md:grid-cols-2">
        {[0, 1].map((key) => (
          <Card key={key} className="flex flex-col gap-3 p-6">
            <Skeleton className="size-11 rounded-full" />
            <Skeleton className="h-5 w-40 max-w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-11 w-36" />
          </Card>
        ))}
      </div>
    </Container>
  );
}
