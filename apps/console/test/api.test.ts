import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const denied = (): Response =>
  Response.json({ error: { code: "UNAUTHORIZED", message: "Sign in again" } }, { status: 401 });

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

describe("session boundaries", () => {
  it("scopes logout to the operator refresh cookie", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = await import("../src/lib/api");

    await client.api.post("/auth/logout");

    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({ "X-Auth-Audience": "operator" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("does not refresh a previous user's cookie after rejected credentials", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(denied());
    vi.stubGlobal("fetch", fetchMock);
    const client = await import("../src/lib/api");
    client.setAccessToken("previous-account");

    await expect(
      client.api.post("/auth/operator/login", { password: "wrong" }),
    ).rejects.toMatchObject({ status: 401 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(client.getAccessToken()).toBe("previous-account");
  });

  it("keeps the idempotency key when a mutation retries after refresh", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(denied())
      .mockResolvedValueOnce(Response.json({ accessToken: "refreshed" }))
      .mockResolvedValueOnce(Response.json({ transactionId: "single-transfer" }));
    vi.stubGlobal("fetch", fetchMock);
    const client = await import("../src/lib/api");
    client.setAccessToken("expired");

    await expect(
      client.api.post("/credits/transfer", { amount: "1000" }, { idempotencyKey: "same-transfer" }),
    ).resolves.toEqual({ transactionId: "single-transfer" });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1]?.[1]?.headers).toMatchObject({ "X-Auth-Audience": "operator" });
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      "Idempotency-Key": "same-transfer",
      Authorization: "Bearer expired",
    });
    expect(fetchMock.mock.calls[2]?.[1]?.headers).toMatchObject({
      "Idempotency-Key": "same-transfer",
      Authorization: "Bearer refreshed",
    });
  });

  it("clears the session if the server rejects the refreshed token too", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(denied())
      .mockResolvedValueOnce(Response.json({ accessToken: "still-invalid" }))
      .mockResolvedValueOnce(denied());
    vi.stubGlobal("fetch", fetchMock);
    const client = await import("../src/lib/api");
    const expired = vi.fn();
    client.setSessionExpiredHandler(expired);

    await expect(client.api.get("/auth/me")).rejects.toMatchObject({ status: 401 });

    expect(expired).toHaveBeenCalledOnce();
    expect(client.getAccessToken()).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not restore a token from a refresh that completes after logout", async () => {
    let completeRefresh: ((response: Response) => void) | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            completeRefresh = resolve;
          }),
      ),
    );
    const client = await import("../src/lib/api");
    const pending = client.refreshSession();
    client.setAccessToken(null);
    completeRefresh?.(Response.json({ accessToken: "logged-out-session" }));

    await expect(pending).resolves.toBe(false);
    expect(client.getAccessToken()).toBeNull();
  });
});
