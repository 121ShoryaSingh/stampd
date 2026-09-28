// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { Button } from "./button";
import { Input } from "./input";

afterEach(cleanup);

describe("ui primitives", () => {
  it("Button renders primary variant with brutal border", () => {
    render(<Button variant="primary">Send</Button>);
    const b = screen.getByRole("button", { name: "Send" });
    expect(b.className).toContain("border-brutal");
    expect(b.className).toContain("bg-red");
  });

  it("Input placeholder reads 'Enter <label>' unless overridden", () => {
    render(<Input label="Work email" name="email" />);
    expect(screen.getByLabelText("Work email")).toHaveProperty("placeholder", "Enter work email");
    render(<Input label="Expires in (days)" name="days" placeholder="Enter days" />);
    expect(screen.getByLabelText("Expires in (days)")).toHaveProperty("placeholder", "Enter days");
  });

  it("Input links its label to the field", () => {
    render(<Input label="Work email" name="email" />);
    expect(screen.getByLabelText("Work email")).toHaveProperty("name", "email");
  });
});
