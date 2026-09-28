import type { Metadata } from "next";
import { InfoPage, Section } from "@/components/marketing/info-page";

export const metadata: Metadata = { title: "Privacy policy - Stampd", description: "Draft privacy policy for Stampd." };

// The data lists describe what the app actually stores; keep them in sync with the schema.
export default function PrivacyPage() {
  return (
    <InfoPage title="Privacy policy" draft updated="[date]" intro="What personal data Stampd handles, why, and what you can ask us to do with it.">
      <Section title="Who is responsible">
        <p>
          For account data, the controller is [company legal name], [registered address], [contact email]. For documents and signer data inside a workspace,
          the organization that owns the workspace is the controller and we process that data on its behalf. [Data processing terms.]
        </p>
      </Section>
      <Section title="What we store">
        <ul>
          <li>Account: name, email address, a scrypt hash of your password, sessions (IP address and browser) and workspace memberships.</li>
          <li>Documents: the PDFs you upload, their SHA-256 fingerprints, the fields placed on them and the values signers fill in.</li>
          <li>Signers and recipients: name and email address, signature and initials images, and for each step the time, IP address and browser (user agent).</li>
          <li>Audit trail: a record of each step taken on a document (for example sent, opened, code verified, signed), kept to prove what happened.</li>
          <li>Emails: a queue of emails to send. Links and codes are removed from it once each email is sent.</li>
        </ul>
      </Section>
      <Section title="Why">
        <ul>
          <li>To run the service you or your organization asked for: sending documents, checking who signs, producing the signed PDF and certificate.</li>
          <li>To keep it secure: rate limiting, audit trails and fraud prevention.</li>
          <li>[Legal bases for each purpose under the laws that apply, for example GDPR Art. 6(1)(b), (c) and (f).]</li>
        </ul>
      </Section>
      <Section title="Cookies">
        <p>Stampd uses only the cookies it needs: a login session cookie, a workspace choice cookie, and a short-lived signer session cookie on signing pages. No advertising or analytics cookies.</p>
      </Section>
      <Section title="Who else handles data">
        <p>Service providers that host the app, store files and send email for us: [hosting provider], [object storage provider], [email provider]. [Where they are located and the transfer safeguards used.]</p>
      </Section>
      <Section title="How long we keep it">
        <p>[Retention periods: accounts, workspaces, signed documents and audit trails, backups.] Signed documents and their audit trails are kept while the workspace exists so they can serve as evidence.</p>
      </Section>
      <Section title="Your rights">
        <p>You can ask for a copy of your data, to correct it, or to delete it, and you can object to some uses. For documents in a workspace, contact the organization that sent them. Email [privacy contact address]. [Supervisory authority and complaint rights.]</p>
      </Section>
    </InfoPage>
  );
}
