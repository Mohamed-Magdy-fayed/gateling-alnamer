import { Skeleton } from "@/components/ui/skeleton";
import { Card, Container } from "@/ui";

/** Account sections while loading: a title, then one Skeleton card per section. */
export default function AccountLoading() {
  return (
    <Container className="flex flex-col gap-6 py-8" aria-busy="true">
      <Skeleton className="h-8 w-40 max-w-full" />
      {[0, 1].map((key) => (
        <Card key={key} className="flex flex-col gap-3 p-6">
          <Skeleton className="h-5 w-32 max-w-full" />
          <Skeleton className="h-11 w-full max-w-md" />
          <Skeleton className="h-11 w-28" />
        </Card>
      ))}
    </Container>
  );
}
