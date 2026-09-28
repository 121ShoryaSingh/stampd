import type { Metadata } from "next";
import { InfoPage, Section } from "@/components/marketing/info-page";

export const metadata: Metadata = { title: "Terms of service - Stampd", description: "Draft terms of service for Stampd." };

export default function TermsPage() {
  return (
    <InfoPage title="Terms of service" draft updated="[date]" intro="These terms apply when your organization uses Stampd to send documents for signature, and when you sign documents sent through Stampd.">
      <Section title="1. Who we are">
        <p>Stampd is operated by [company legal name], [registered address] (&quot;we&quot;). Contact: [contact email].</p>
      </Section>
      <Section title="2. Accounts and workspaces">
        <ul>
          <li>You must give accurate details and keep your password safe. You are responsible for activity in your account.</li>
          <li>A workspace belongs to the organization that created it. Workspace admins decide who is a member and can remove members.</li>
        </ul>
      </Section>
      <Section title="3. Your documents">
        <ul>
          <li>You keep all rights in the documents you upload. You let us store and process them only to provide the service.</li>
          <li>You confirm you may send each document and the personal data in it to the people you choose as signers and recipients.</li>
          <li>Signed PDFs and audit records are kept while your workspace exists, unless the law requires otherwise. [Retention and deletion terms.]</li>
        </ul>
      </Section>
      <Section title="4. Electronic signatures">
        <p>
          Stampd records who signed, when, from which IP address and device, after an email code check and explicit consent, and seals the result. Whether an
          electronic signature is valid for a particular document depends on the law that applies to it. Some documents need extra formalities. You are
          responsible for choosing electronic signatures only where they are allowed. [Jurisdiction-specific wording.]
        </p>
      </Section>
      <Section title="5. Acceptable use">
        <ul>
          <li>No unlawful, fraudulent or misleading documents, and no sending to people who have not agreed to deal with you.</li>
          <li>No attempts to break, overload or get around the security of the service.</li>
        </ul>
      </Section>
      <Section title="6. Plans and fees">
        <p>[Plans, prices, billing, trials and refunds. Stampd v1 has no billing; describe what applies at launch.]</p>
      </Section>
      <Section title="7. Availability and changes">
        <p>We work to keep Stampd available and secure, but we do not promise it will never be interrupted. We may change features; we will tell you about changes that reduce what you get. [Notice periods.]</p>
      </Section>
      <Section title="8. Liability">
        <p>[Limitation of liability, exclusions and caps, as allowed by applicable law.]</p>
      </Section>
      <Section title="9. Ending the service">
        <p>You can stop using Stampd at any time. We may suspend accounts that break these terms. [What happens to data on termination and how to export it.]</p>
      </Section>
      <Section title="10. Law and disputes">
        <p>[Governing law and courts.]</p>
      </Section>
    </InfoPage>
  );
}
