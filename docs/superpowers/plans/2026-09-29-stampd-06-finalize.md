# Stampd Plan 6: Signed PDF (stamp, certificate, seal)

**Goal:** When the last signer signs, the worker produces the final PDF: the original with every field drawn in place, a certificate of completion, and a PAdES seal that makes any later change visible in PDF readers. The sender and every recipient (signers and cc) get it by email; the sender can download it from the envelope page any time.

**Spec:** section 6 (Finalization), 7 (audit), 10 (PDF tests). Builds on Plan 5 (outbox and worker).

## Decisions

1. **Job state on the envelope, not a queue.** `seal_run_at`, `seal_attempts`, `seal_locked_until` on `envelopes`. Completing an envelope sets `seal_run_at` in the same transaction; the worker claims due envelopes with a 5-minute lease (safe with several workers). Three tries with backoff 1 min, 5 min; then `last_error` is shown with a "Try again" button (`seal_retried`, `seal_failed` audited).
2. **Coordinates as the editor saw them.** Fields are fractions of the visible page (crop box, turned by `/Rotate`). `toUser()` maps them to PDF user space and draws rotated content upright. Tests read the result back with pdf.js at scale 1 for 0/90/180/270 degrees with an offset crop box.
3. **Fonts.** DejaVu Sans (Latin, Greek, Cyrillic), subset-embedded. pdf-lib cannot shape complex scripts, so other characters print as "?" on the certificate (next to the email address). Signature images keep any script (the browser draws them).
4. **Seal.** Our own CMS builder (`der.ts`, `seal.ts`) instead of `P12Signer`: PAdES baseline needs `signingCertificateV2` and no CMS `signingTime`. Key and chain from a PKCS#12 file (`SEAL_P12_PATH` or `SEAL_P12_BASE64`, `SEAL_P12_PASSWORD`); RSA or EC. `verifySeal()` checks byte range, digest, pinned certificate hash and signature; tests also verify with OpenSSL CMS and poppler `pdfsig` when installed.
5. **Downloads.** The sealed key ends in `<title>-signed.pdf` (presigned links cannot set a filename). Emails carry a 7-day presigned link (scrubbed from the outbox after sending); the app route mints a 5-minute link per click.
6. **Integrity gates before sealing:** the stored original must still match `documents.sha256`, and the audit chain must verify; the certificate prints the audit hash and the event it covers.

## Tasks (done)

- [x] Geometry, fonts, stamping, certificate, CMS seal and verifier with tests (`src/server/finalize/*`).
- [x] Finalize service, worker loop, retry action, download route, "Signed PDF" card with auto-refresh.
- [x] Emails: `completed` (sender, with download) and `signed_copy` (each recipient).
- [x] `npm run seal:dev-cert` for a self-issued development certificate; e2e worker gets a throwaway one.
- [x] E2E: two signers sign, the page shows the download, the file is a sealed PDF, both get their copy.

## Open items

- A document-signing certificate from a CA on the Adobe Approved Trust List, so readers show a trusted identity instead of "issuer unknown".
- Long-term validation (PAdES B-T/B-LT: RFC 3161 timestamp, embedded revocation data) needs a timestamp authority; not in v1.
