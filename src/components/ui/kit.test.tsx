// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { useState } from "react";
import { Button } from "./button";
import { Input } from "./input";
import { Badge } from "./badge";
import { Modal } from "./modal";
import { ToastProvider, useToast } from "./toast";

afterEach(cleanup);

describe("Button", () => {
  it("loading disables it and keeps its accessible name", () => {
    render(<Button loading>Send</Button>);
    const b = screen.getByRole("button", { name: /Send/ });
    expect(b).toHaveProperty("disabled", true);
    expect(b.getAttribute("aria-busy")).toBe("true");
  });
});

describe("Input", () => {
  it("wires error text to the field", () => {
    render(<Input label="Title" name="t" error="Title is required" />);
    const input = screen.getByLabelText("Title");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    const id = input.getAttribute("aria-describedby")!;
    expect(document.getElementById(id)?.textContent).toBe("Title is required");
  });
});

describe("Badge", () => {
  it("always renders its text", () => {
    render(<Badge tone="green">signed</Badge>);
    expect(screen.getByText("signed")).toBeTruthy();
  });
});

function ModalHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Open</button>
      <Modal open={open} onClose={() => setOpen(false)} title="Void envelope">
        <input aria-label="Reason" />
        <button>Confirm</button>
      </Modal>
    </>
  );
}

describe("Modal", () => {
  it("is a labelled dialog that traps focus, closes on Escape and restores focus", () => {
    render(<ModalHarness />);
    const opener = screen.getByRole("button", { name: "Open" });
    opener.focus();
    fireEvent.click(opener);
    const dialog = screen.getByRole("dialog", { name: "Void envelope" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.contains(document.activeElement)).toBe(true);

    const confirm = screen.getByRole("button", { name: "Confirm" });
    confirm.focus();
    fireEvent.keyDown(confirm, { key: "Tab" });
    expect(dialog.contains(document.activeElement)).toBe(true);

    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
});

function ToastHarness() {
  const { show } = useToast();
  return <button onClick={() => show("Saved")}>Go</button>;
}

describe("Toast", () => {
  it("announces in a live region and disappears", () => {
    vi.useFakeTimers();
    render(
      <ToastProvider>
        <ToastHarness />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Go" }));
    const region = screen.getByRole("status");
    expect(region.textContent).toContain("Saved");
    act(() => {
      vi.advanceTimersByTime(4500);
    });
    expect(screen.getByRole("status").textContent).not.toContain("Saved");
    vi.useRealTimers();
  });
});
