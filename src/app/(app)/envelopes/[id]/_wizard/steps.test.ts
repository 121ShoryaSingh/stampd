import { describe, it, expect } from "vitest";
import { firstOpenStep, progress, reachable } from "./steps";

type Draft = Parameters<typeof progress>[0];
const draft = (d: { document?: boolean; recipients?: { id: string; role: "signer" | "cc" }[]; fields?: { recipientId: string; type: string }[] }) =>
  ({ document: d.document ? {} : null, recipients: d.recipients ?? [], fields: d.fields ?? [] }) as unknown as Draft;

describe("wizard steps", () => {
  it("opens each step once the ones before it are done", () => {
    const empty = progress(draft({}));
    expect(firstOpenStep(empty)).toBe("upload");
    expect(reachable("details", empty)).toBe(true);
    expect(reachable("upload", empty)).toBe(true);
    expect(reachable("recipients", empty)).toBe(false);

    const withPdf = progress(draft({ document: true }));
    expect(firstOpenStep(withPdf)).toBe("recipients");
    expect(reachable("fields", withPdf)).toBe(false);
  });

  it("needs a signer (a cc is not enough) and a signature field for every signer", () => {
    const ccOnly = progress(draft({ document: true, recipients: [{ id: "c", role: "cc" }] }));
    expect(firstOpenStep(ccOnly)).toBe("recipients");

    const people = [
      { id: "a", role: "signer" as const },
      { id: "b", role: "signer" as const },
    ];
    const half = progress(draft({ document: true, recipients: people, fields: [{ recipientId: "a", type: "signature" }, { recipientId: "b", type: "text" }] }));
    expect(firstOpenStep(half)).toBe("fields");
    expect(reachable("review", half)).toBe(false);

    const ready = progress(draft({ document: true, recipients: people, fields: [{ recipientId: "a", type: "signature" }, { recipientId: "b", type: "signature" }] }));
    expect(firstOpenStep(ready)).toBe("review");
    expect(reachable("review", ready)).toBe(true);
  });
});
