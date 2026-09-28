import { Suspense } from "react";
import { ResetForm } from "./reset-form";

export const metadata = { title: "Choose a new password - Stampd" };

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetForm />
    </Suspense>
  );
}
