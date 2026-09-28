import { Skeleton } from "@/components/ui/layout";

export default function Loading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading envelopes">
      <Skeleton className="h-12 w-64" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <Skeleton className="h-72" />
    </div>
  );
}
