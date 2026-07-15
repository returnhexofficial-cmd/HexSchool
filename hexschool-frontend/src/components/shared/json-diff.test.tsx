import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { JsonDiff } from "./json-diff";

describe("<JsonDiff>", () => {
  it("shows the union of keys with old and new values", () => {
    render(
      <JsonDiff
        oldValues={{ name: "Old Name", removed: true }}
        newValues={{ name: "New Name", added: 1 }}
      />,
    );
    expect(screen.getByText("name")).toBeInTheDocument();
    expect(screen.getByText("removed")).toBeInTheDocument();
    expect(screen.getByText("added")).toBeInTheDocument();
    expect(screen.getByText('"Old Name"')).toBeInTheDocument();
    expect(screen.getByText('"New Name"')).toBeInTheDocument();
  });

  it("marks changed rows and leaves identical rows unmarked", () => {
    render(
      <JsonDiff
        oldValues={{ same: "x", changed: "a" }}
        newValues={{ same: "x", changed: "b" }}
      />,
    );
    const changedRow = screen.getByText("changed").closest("tr");
    const sameRow = screen.getByText("same").closest("tr");
    expect(changedRow).toHaveAttribute("data-changed");
    expect(sameRow).not.toHaveAttribute("data-changed");
  });

  it("handles create-only entries (no old values)", () => {
    render(<JsonDiff oldValues={null} newValues={{ slug: "new-role" }} />);
    expect(screen.getByText("slug")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("renders a placeholder when both sides are empty", () => {
    render(<JsonDiff oldValues={null} newValues={null} />);
    expect(screen.getByText("No recorded values.")).toBeInTheDocument();
  });
});
