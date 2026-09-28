// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { Input } from "./input";
import { DatePicker, daysUntil } from "./date-picker";

afterEach(cleanup);

describe("Input uses the shadcn input", () => {
  it("renders shadcn's input with our label, placeholder and error wiring", () => {
    render(<Input label="Title" name="t" error="Required" />);
    const input = screen.getByLabelText("Title");
    expect(input.getAttribute("data-slot")).toBe("input");
    expect(input.getAttribute("placeholder")).toBe("Enter title");
    expect(input.getAttribute("aria-invalid")).toBe("true");
  });
});

describe("daysUntil", () => {
  it("counts whole days from today, at least 1", () => {
    const now = new Date("2026-09-29T15:00:00Z");
    expect(daysUntil(new Date("2026-10-29T00:00:00Z"), now)).toBe(30);
    expect(daysUntil(new Date("2026-09-29T00:00:00Z"), now)).toBe(1);
  });
});

describe("DatePicker", () => {
  it("shows the chosen date, opens a calendar and submits the ISO date", () => {
    const value = new Date(2026, 9, 29);
    const { container } = render(<DatePicker label="Expires on" name="expiresOn" defaultValue={value} />);
    const trigger = screen.getByRole("button", { name: /Expires on/ });
    expect(trigger.textContent).toContain("October 29th, 2026");
    expect((container.querySelector('input[name="expiresOn"]') as HTMLInputElement).value).toBe("2026-10-29");
    fireEvent.click(trigger);
    expect(screen.getByRole("grid")).toBeTruthy();
  });
});
