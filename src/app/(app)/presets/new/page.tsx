import { redirect } from "next/navigation";
import { requireTenant } from "@/server/tenants/current";
import { NewPresetForm } from "./new-form";

export default async function NewPresetPage() {
  const { tenant } = await requireTenant();
  if (tenant.role !== "admin") redirect("/presets");
  return <NewPresetForm />;
}
