// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, act, within } from "@testing-library/react";
import { useState } from "react";
import { ConfirmSubmit, useConfirm } from "./confirm";

afterEach(cleanup);

function Harness() {
  const [confirm, dialog] = useConfirm();
  const [answer, setAnswer] = useState("none");
  return (
    <>
      <button onClick={async () => setAnswer(String(await confirm({ title: "Leave?", message: "Changes are lost.", confirmLabel: "Leave", tone: "danger" })))}>Go</button>
      <p>answer: {answer}</p>
      {dialog}
    </>
  );
}

describe("useConfirm", () => {
  it("asks in a labelled dialog with Cancel focused, and resolves with the choice", async () => {
    vi.spyOn(window, "confirm");
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Go" }));
    const dialog = screen.getByRole("dialog", { name: "Leave?" });
    expect(dialog.textContent).toContain("Changes are lost.");
    // The safe choice has focus, so Enter never confirms by accident.
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" }));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Leave" })));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("answer: true")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Go" }));
    await act(async () => fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" }));
    expect(screen.getByText("answer: false")).toBeTruthy();
    expect(window.confirm).not.toHaveBeenCalled();
  });
});

describe("ConfirmSubmit", () => {
  it("only submits its form after confirming", () => {
    const submit = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(
      <form onSubmit={submit}>
        <ConfirmSubmit confirm={{ title: "Delete this draft?", message: "This cannot be undone.", confirmLabel: "Delete draft", tone: "danger" }}>Delete draft</ConfirmSubmit>
      </form>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete draft" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(submit).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Delete draft" }));
    const dialog = screen.getByRole("dialog", { name: "Delete this draft?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete draft" }));
    expect(submit).toHaveBeenCalledTimes(1);
  });
});
