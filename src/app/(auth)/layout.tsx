import { ArrowLeft } from "lucide-react";
import { ButtonLink } from "@/components/ui/button-link";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid min-h-screen place-items-center bg-[radial-gradient(#000_1.2px,transparent_1.2px)] [background-size:22px_22px] p-6">
      <div className="w-full max-w-md space-y-4">
        <ButtonLink href="/" icon={<ArrowLeft aria-hidden className="h-5 w-5" />}>
          Back to home
        </ButtonLink>
        {children}
      </div>
    </main>
  );
}
