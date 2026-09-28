import type { Metadata } from "next";
import { InfoPage, Section } from "@/components/marketing/info-page";

export const metadata: Metadata = { title: "Security - Stampd", description: "How Stampd protects documents, signers and workspaces." };

// Every statement here describes what the code does; keep it in sync when that changes.
export default function SecurityPage() {
  return (
    <InfoPage title="Security" updated="2026-09-29" intro="How Stampd keeps documents, signers and workspaces safe. Plain words, no badges.">
      <Section title="Workspaces are separated by the database">
        <p>
          Every table that holds workspace data has PostgreSQL row-level security switched on and forced. The app connects with a database role that cannot
          bypass it, and every query runs with the current workspace set for that transaction only. A bug in one screen cannot show another company&apos;s
          documents, because the database itself refuses.
        </p>
      </Section>
      <Section title="Signing links and codes">
        <ul>
          <li>Each signing link carries a 256-bit random token. We store only its SHA-256 hash, so the database alone cannot recreate a link.</li>
          <li>Links are issued when a signer&apos;s turn comes. A reminder or a resend issues a new link, and the older one stops working.</li>
          <li>Before signing, the signer enters a 6-digit code sent to their email. Codes are stored hashed, expire after 10 minutes and lock after 5 wrong tries.</li>
          <li>Signing pages never send the link to other sites (no referrer), and the signer session lasts 2 hours.</li>
        </ul>
      </Section>
      <Section title="A tamper-evident record">
        <ul>
          <li>Every step (sent, opened, code verified, consent, signed, declined, voided) is written to an audit trail with time, IP address and device.</li>
          <li>Each event is chained to the previous one with SHA-256, and the app&apos;s database role cannot update or delete audit events.</li>
          <li>
            The finished PDF gets a certificate of completion and a PAdES digital seal (ETSI.CAdES.detached) over the whole file. Any change after sealing shows
            as an invalid signature in PDF readers.
          </li>
          <li>Before sealing, Stampd checks that the stored original still matches the fingerprint taken at upload, and that the audit chain is intact.</li>
        </ul>
      </Section>
      <Section title="Documents and downloads">
        <ul>
          <li>Uploads must be real PDFs (up to 25 MB and 200 pages); the fingerprint is computed on our side, not trusted from the browser.</li>
          <li>Files live in private object storage. The app hands out download links that expire after 5 minutes; the signed copy sent by email works for 7 days.</li>
          <li>Emails are queued in the database and sent by a background worker; links and codes are removed from the queue once the email is out.</li>
        </ul>
      </Section>
      <Section title="Accounts">
        <ul>
          <li>Passwords are hashed with scrypt and must be at least 10 characters.</li>
          <li>Sign-in, sign-up and password-reset requests are rate limited per IP address.</li>
          <li>Resetting a password signs the account out on every device. Reset links expire after 1 hour and work once.</li>
        </ul>
      </Section>
      <Section title="Report a problem">
        <p>Found a security issue? Email [security contact address]. Please give us a reasonable time to fix it before telling others.</p>
      </Section>
    </InfoPage>
  );
}
