import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "./data-table";

interface Row {
  name: string;
  roll: number;
}

const columns: ColumnDef<Row>[] = [
  { accessorKey: "name", header: "Name" },
  { accessorKey: "roll", header: "Roll" },
];

const rows: Row[] = [
  { name: "Ayesha", roll: 1 },
  { name: "Rahim", roll: 2 },
];

const meta = { page: 2, limit: 20, total: 55, totalPages: 3 };

describe("DataTable (server-driven)", () => {
  it("renders rows and server pagination meta", () => {
    render(<DataTable columns={columns} data={rows} meta={meta} />);

    expect(screen.getByText("Ayesha")).toBeInTheDocument();
    expect(screen.getByText("Rahim")).toBeInTheDocument();
    expect(screen.getByText("Page 2 of 3")).toBeInTheDocument();
    expect(screen.getByText("21–40 of 55")).toBeInTheDocument();
  });

  it("reports page changes instead of paginating client-side", async () => {
    const onPageChange = vi.fn();
    render(
      <DataTable
        columns={columns}
        data={rows}
        meta={meta}
        onPageChange={onPageChange}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(onPageChange).toHaveBeenCalledWith(3);

    await userEvent.click(screen.getByRole("button", { name: "Previous" }));
    expect(onPageChange).toHaveBeenCalledWith(1);
  });

  it("disables Previous on the first page and Next on the last", () => {
    render(
      <DataTable
        columns={columns}
        data={rows}
        meta={{ page: 1, limit: 20, total: 10, totalPages: 1 }}
        onPageChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });

  it("shows the empty state when there are no rows", () => {
    render(
      <DataTable
        columns={columns}
        data={[]}
        meta={{ page: 1, limit: 20, total: 0, totalPages: 1 }}
        emptyTitle="No students"
      />,
    );

    expect(screen.getByText("No students")).toBeInTheDocument();
  });

  it("forwards search input to the server callback", async () => {
    const onSearchChange = vi.fn();
    render(
      <DataTable
        columns={columns}
        data={rows}
        meta={meta}
        onSearchChange={onSearchChange}
      />,
    );

    await userEvent.type(screen.getByRole("textbox", { name: "Search" }), "a");
    expect(onSearchChange).toHaveBeenCalledWith("a");
  });
});
