import { Skeleton } from "@/components/ui/layout";

export default function Loading() {
  return (
    <div className="space-y-6" role="status" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-12 w-72" />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Skeleton className="h-80" />
        <Skeleton className="h-80" />
      </div>
    </div>
  );
}
