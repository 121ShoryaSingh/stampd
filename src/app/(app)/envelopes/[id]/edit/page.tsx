import { redirect } from "next/navigation";

// The old one-page editor is now the wizard's recipients and fields steps.
export default async function EditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/envelopes/${encodeURIComponent(id)}/recipients`);
}
