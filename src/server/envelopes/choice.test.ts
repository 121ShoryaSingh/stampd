import { describe, it, expect } from "vitest";
import { normalizeFields, type FieldInput } from "./fields";

const box = (over: Partial<FieldInput> = {}): FieldInput => ({ recipientId: "r1", type: "choice", page: 1, x: 0.1, y: 0.1, w: 0.03, h: 0.02, groupKey: "q1", option: "Yes", mark: "check", ...over });
const run = (fields: FieldInput[]) => normalizeFields(fields, (f) => f.recipientId);

describe("normalizeFields", () => {
  it("accepts a question with answer boxes anywhere, and shares required and label across it", () => {
    const rows = run([box({ label: "  Any   mortgages? ", required: false }), box({ option: " No ", x: 0.8, y: 0.5, required: true }), box({ option: "N/A", page: 1, x: 0.5 })]);
    expect(rows.map((r) => [r.option, r.label, r.required])).toEqual([
      ["Yes", "Any mortgages?", true],
      ["No", "Any mortgages?", true],
      ["N/A", "Any mortgages?", true],
    ]);
  });

  it("clears choice details from other fields and keeps their own label", () => {
    const [t] = run([{ recipientId: "r1", type: "text", page: 1, x: 0.1, y: 0.1, w: 0.2, h: 0.03, label: "Company name", groupKey: "x", option: "y", mark: "check" }]);
    expect(t).toMatchObject({ label: "Company name", groupKey: null, option: null, mark: null, required: true });
    const [c] = run([{ recipientId: "r1", type: "checkbox", page: 1, x: 0.1, y: 0.1, w: 0.03, h: 0.02 }]);
    expect(c.required).toBe(false);
  });

  it("rejects broken questions", () => {
    expect(() => run([box()])).toThrow(/at least two answer boxes/);
    expect(() => run([box(), box({ option: "yes" })])).toThrow(/two answers called "yes"/);
    expect(() => run([box(), box({ option: "No", recipientId: "r2" })])).toThrow(/different signers/);
    expect(() => run([box(), box({ option: "No", mark: "circle" })])).toThrow(/mixes mark styles/);
    expect(() => run([box(), box({ option: "  " })])).toThrow(/needs a label/);
    expect(() => run([box({ groupKey: null })])).toThrow(/not linked/);
    expect(() => run([box({ mark: null })])).toThrow(/how the chosen answer is marked/);
    expect(() => run(Array.from({ length: 11 }, (_, i) => box({ option: `O${i}` })))).toThrow(/at most 10/);
    expect(() => run([box({ label: "x".repeat(81) }), box({ option: "No" })])).toThrow(/at most 80/);
  });

  it("only restricts answer characters when the answer is written on the PDF", () => {
    expect(() => run([box({ option: "हाँ" }), box({ option: "नहीं" })])).not.toThrow();
    expect(() => run([box({ option: "हाँ", mark: "text" }), box({ option: "No", mark: "text" })])).toThrow(/cannot show/);
  });
});
