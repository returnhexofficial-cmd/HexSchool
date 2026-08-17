import { afterEach, beforeEach, describe, expect, it } from "vitest";
import MockAdapter from "axios-mock-adapter";
import type { AxiosInstance } from "axios";
import { createApiClient, setAccessToken } from "./axios";

describe("api client refresh interceptor", () => {
  let client: AxiosInstance;
  let mock: MockAdapter;

  beforeEach(() => {
    setAccessToken(null);
    client = createApiClient();
    mock = new MockAdapter(client);
  });

  afterEach(() => {
    mock.restore();
    setAccessToken(null);
  });

  it("attaches the access token to requests", async () => {
    setAccessToken("token-abc");
    mock.onGet("/students").reply((config) => {
      expect(config.headers?.Authorization).toBe("Bearer token-abc");
      return [200, { success: true, data: [] }];
    });

    const res = await client.get("/students");
    expect(res.status).toBe(200);
  });

  it("refreshes once on 401 and retries the original request", async () => {
    setAccessToken("expired");
    let refreshCalls = 0;

    mock
      .onGet("/students")
      .replyOnce(401, { success: false, error: { code: "UNAUTHORIZED", message: "expired" } });
    mock.onPost("/auth/refresh").reply(() => {
      refreshCalls += 1;
      return [200, { success: true, data: { accessToken: "fresh-token" } }];
    });
    mock.onGet("/students").reply((config) => {
      expect(config.headers?.Authorization).toBe("Bearer fresh-token");
      return [200, { success: true, data: ["ok"] }];
    });

    const res = await client.get("/students");
    expect(refreshCalls).toBe(1);
    expect(res.data).toEqual({ success: true, data: ["ok"] });
  });

  it("single-flights concurrent 401s through one refresh call", async () => {
    setAccessToken("expired");
    let refreshCalls = 0;

    mock.onGet("/a").replyOnce(401).onGet("/b").replyOnce(401);
    mock.onPost("/auth/refresh").reply(async () => {
      refreshCalls += 1;
      await new Promise((r) => setTimeout(r, 30));
      return [200, { success: true, data: { accessToken: "fresh" } }];
    });
    mock.onGet("/a").reply(200, { success: true, data: "a" });
    mock.onGet("/b").reply(200, { success: true, data: "b" });

    const [ra, rb] = await Promise.all([client.get("/a"), client.get("/b")]);
    expect(refreshCalls).toBe(1);
    expect(ra.status).toBe(200);
    expect(rb.status).toBe(200);
  });

  it("rejects without retry loops when refresh itself fails", async () => {
    setAccessToken("expired");
    mock.onGet("/students").reply(401);
    mock.onPost("/auth/refresh").reply(401);

    await expect(client.get("/students")).rejects.toMatchObject({
      response: { status: 401 },
    });
  });

  /**
   * QA finding F3 — a 401 from a credential endpoint is the business answer,
   * not an expired token. Retrying it sent the same wrong password twice,
   * doubling audit rows and burning the 5/min credential throttle.
   */
  describe("business 401s are not refreshed (F3)", () => {
    it.each([
      "/auth/change-password",
      "/auth/login",
      "/auth/reset-password",
      "/auth/verify-otp",
    ])(
      "does not refresh or re-send %s on 401",
      async (endpoint) => {
        setAccessToken("valid-token");
        let attempts = 0;
        let refreshCalls = 0;

        mock.onPost(endpoint).reply(() => {
          attempts += 1;
          return [
            401,
            {
              success: false,
              error: { code: "UNAUTHORIZED", message: "Current password is incorrect" },
            },
          ];
        });
        mock.onPost("/auth/refresh").reply(() => {
          refreshCalls += 1;
          return [200, { success: true, data: { accessToken: "fresh" } }];
        });

        await expect(client.post(endpoint, {})).rejects.toMatchObject({
          response: { status: 401 },
        });

        expect(attempts, "the request must be sent exactly once").toBe(1);
        expect(refreshCalls, "no refresh should be attempted").toBe(0);
      },
    );

    it("still refreshes a 401 from an ordinary data endpoint", async () => {
      // The guard must be narrow: the bootstrap handshake depends on this
      // path, so it has to keep working.
      setAccessToken("expired");
      let refreshCalls = 0;

      mock.onGet("/students").replyOnce(401);
      mock.onPost("/auth/refresh").reply(() => {
        refreshCalls += 1;
        return [200, { success: true, data: { accessToken: "fresh" } }];
      });
      mock.onGet("/students").reply(200, { success: true, data: [] });

      const res = await client.get("/students");
      expect(refreshCalls).toBe(1);
      expect(res.status).toBe(200);
    });

    it("still refreshes a 401 from an endpoint whose name merely contains 'login'", async () => {
      // endsWith matching, not substring — /login-activities is a data route.
      setAccessToken("expired");
      let refreshCalls = 0;

      mock.onGet("/auth/login-activities").replyOnce(401);
      mock.onPost("/auth/refresh").reply(() => {
        refreshCalls += 1;
        return [200, { success: true, data: { accessToken: "fresh" } }];
      });
      mock.onGet("/auth/login-activities").reply(200, { success: true, data: [] });

      const res = await client.get("/auth/login-activities");
      expect(refreshCalls).toBe(1);
      expect(res.status).toBe(200);
    });
  });
});
