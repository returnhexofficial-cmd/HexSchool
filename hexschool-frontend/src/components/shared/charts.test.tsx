import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { BarRow, ColumnChart, Sparkline } from "./charts";

describe("Sparkline", () => {
  it("breaks the line at a gap instead of bridging it", () => {
    const { container } = render(
      <Sparkline
        data={[
          { label: "01", value: 90 },
          { label: "02", value: 80 },
          { label: "03", value: null },
          { label: "04", value: 70 },
          { label: "05", value: 60 },
        ]}
      />,
    );

    // Two drawn segments, not one path straight through the missing day —
    // an unmarked day must not be interpolated into existence.
    const paths = container.querySelectorAll("path");
    expect(paths).toHaveLength(2);
  });

  it("never plots a null at the baseline", () => {
    const { container } = render(
      <Sparkline
        data={[
          { label: "01", value: 50 },
          { label: "02", value: null },
          { label: "03", value: 50 },
        ]}
      />,
    );

    // One point per non-null day only.
    expect(container.querySelectorAll("circle")).toHaveLength(2);
  });

  it("labels only the extremes, not every point", () => {
    render(
      <Sparkline
        data={[
          { label: "01", value: 91 },
          { label: "02", value: 42 },
          { label: "03", value: 77 },
        ]}
        format={(n) => `${n}%`}
      />,
    );

    expect(screen.getByText(/low 42% · peak 91%/)).toBeInTheDocument();
    // 77 is neither extreme, so it appears only in the hover title.
    expect(screen.queryByText("77%")).not.toBeInTheDocument();
  });

  it("survives a series where every value is missing", () => {
    render(
      <Sparkline
        data={[
          { label: "01", value: null },
          { label: "02", value: null },
        ]}
      />,
    );

    expect(screen.getByText("Nothing recorded yet.")).toBeInTheDocument();
  });

  it("does not collapse a flat series onto the baseline", () => {
    const { container } = render(
      <Sparkline
        data={[
          { label: "01", value: 80 },
          { label: "02", value: 80 },
        ]}
      />,
    );

    const path = container.querySelector("path");
    // A zero-height band would divide by zero and emit NaN coordinates.
    expect(path?.getAttribute("d")).not.toContain("NaN");
  });
});

describe("BarRow", () => {
  it("scales against the supplied max, not the row's own value", () => {
    const { container } = render(<BarRow label="Class 6" value={25} max={100} />);

    const fill = container.querySelector("[aria-hidden]") as HTMLElement;
    expect(fill.style.width).toBe("25%");
  });

  it("renders 0% rather than NaN when the max is zero", () => {
    const { container } = render(<BarRow label="Empty" value={0} max={0} />);

    const fill = container.querySelector("[aria-hidden]") as HTMLElement;
    expect(fill.style.width).toBe("0%");
  });
});

describe("ColumnChart", () => {
  it("labels each column for screen readers", () => {
    render(
      <ColumnChart
        data={[
          { label: "05", value: 1200 },
          { label: "06", value: 900 },
        ]}
        format={(n) => `৳${n}`}
      />,
    );

    expect(screen.getByLabelText("05: ৳1200")).toBeInTheDocument();
    expect(screen.getByLabelText("06: ৳900")).toBeInTheDocument();
  });
});
