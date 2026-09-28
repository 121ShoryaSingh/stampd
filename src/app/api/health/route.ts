import { NextResponse } from "next/server";
import { withDb } from "@/server/db/context";

export const dynamic = "force-dynamic";

// For the load balancer and container health checks: the app is up and can reach Postgres.
export async function GET() {
  try {
    await withDb({}, (tx) => tx.tenant.count({ where: { id: "00000000-0000-0000-0000-000000000000" } }));
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
