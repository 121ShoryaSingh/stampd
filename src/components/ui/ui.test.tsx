// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Button } from "./button";
import { Input } from "./input";

describe("ui primitives", () => {
  it("Button renders primary variant with brutal border", () => {
    render(<Button variant="primary">Send</Button>);
    const b = screen.getByRole("button", { name: "Send" });
    expect(b.className).toContain("border-brutal");
    expect(b.className).toContain("bg-red");
  });

  it("Input links its label to the field", () => {
    render(<Input label="Work email" name="email" />);
    expect(screen.getByLabelText("Work email")).toHaveProperty("name", "email");
  });
});
