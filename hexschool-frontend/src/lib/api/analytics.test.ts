import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { analyticsApi, recordPageView } from "./analytics";
import { api } from "./axios";

/**
 * The client's own decisions, not the backend's: the paginated unwrap
 * (the M18 lesson — the interceptor lifts `meta` and leaves rows in
 * `data`, so it is ONE unwrap), the re-signed download, and the beacon
 * that must never throw.
 */

describe("analyticsApi.runs — the paginated unwrap", () => {
  it("unwraps once, keeping meta at the top level", async () => {
    const get = vi.spyOn(api, "get").mockResolvedValue({
      data: {
        success: true,
        data: [{ id: "run-1" }],
        meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
      },
    } as never);

    const result = await analyticsApi.runs({ mine: true });

    expect(result.data).toEqual([{ id: "run-1" }]);
    expect(result.meta?.total).toBe(1);
    // `mine` goes over the wire as the string the DTO expects.
    expect(get).toHaveBeenCalledWith("/report-runs", {
      params: { mine: "true" },
    });
    get.mockRestore();
  });

  it("omits `mine` entirely when it is false", async () => {
    const get = vi.spyOn(api, "get").mockResolvedValue({
      data: { success: true, data: [], meta: undefined },
    } as never);

    await analyticsApi.runs({ mine: false, limit: 10 });

    expect(get).toHaveBeenCalledWith("/report-runs", {
      params: { mine: undefined, limit: 10 },
    });
    get.mockRestore();
  });
});

describe("analyticsApi.download", () => {
  let clicked: string[];

  beforeEach(() => {
    clicked = [];
    vi.spyOn(document, "createElement").mockImplementation(() => {
      const anchor = {
        href: "",
        download: "",
        target: "",
        rel: "",
        click: () => clicked.push(anchor.href),
      };
      return anchor as unknown as HTMLAnchorElement;
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it("fetches a fresh signed URL rather than reusing a stored one", async () => {
    // The URL on the row was signed at generation time and is long expired
    // by the time anybody looks at the list.
    const get = vi.spyOn(api, "get").mockResolvedValue({
      data: {
        success: true,
        data: { url: "https://s3.test/fresh", filename: "dues.xlsx" },
      },
    } as never);

    await analyticsApi.download("run-1");

    expect(get).toHaveBeenCalledWith("/report-runs/run-1/download");
    expect(clicked).toEqual(["https://s3.test/fresh"]);
  });
});

describe("recordPageView", () => {
  afterEach(() => vi.restoreAllMocks());

  it("posts the path and referrer to the public beacon", async () => {
    const post = vi.spyOn(api, "post").mockResolvedValue({} as never);
    await recordPageView("/notices", "https://google.com/");
    expect(post).toHaveBeenCalledWith("/public/analytics/collect", {
      path: "/notices",
      referrer: "https://google.com/",
    });
  });

  it("swallows a failure — a counter must not break the page", async () => {
    vi.spyOn(api, "post").mockRejectedValue(new Error("network down"));
    await expect(recordPageView("/")).resolves.toBeUndefined();
  });
});

describe("analyticsApi.refreshViews", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns the per-view outcomes so a partial failure is visible", async () => {
    vi.spyOn(api, "post").mockResolvedValue({
      data: {
        success: true,
        data: {
          views: [
            { view: "mv_attendance_monthly", ok: true, durationMs: 40 },
            {
              view: "mv_result_summary",
              ok: false,
              durationMs: 5,
              error: "boom",
            },
          ],
        },
      },
    } as never);

    const views = await analyticsApi.refreshViews();

    expect(views).toHaveLength(2);
    expect(views.filter((v) => !v.ok)).toHaveLength(1);
  });
});
