export { describeEvent } from "@/server/audit/describe";

export function relativeTime(d: Date, now = new Date()) {
  const s = Math.round((now.getTime() - d.getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 604_800) return `${Math.floor(s / 86_400)} d ago`;
  return d.toISOString().slice(0, 10);
}
