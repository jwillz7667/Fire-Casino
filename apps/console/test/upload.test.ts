import { afterEach, expect, it, vi } from "vitest";
import { api } from "../src/lib/api";
import { uploadViaPresign } from "../src/lib/upload";

vi.mock("../src/lib/api", () => ({ api: { post: vi.fn() } }));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("returns the canonical fileUrl actually provided by object storage", async () => {
  vi.spyOn(api, "post").mockResolvedValue({
    uploadUrl: "https://storage.example/upload",
    fileUrl: "https://storage.example/proofs/receipt.png",
    key: "proofs/receipt.png",
  });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
  const file = new File(["receipt"], "receipt.png", { type: "image/png" });

  await expect(uploadViaPresign("/orders/proof-url", file)).resolves.toBe(
    "https://storage.example/proofs/receipt.png",
  );
});

it("rejects a failed object upload without returning a proof URL", async () => {
  vi.spyOn(api, "post").mockResolvedValue({
    uploadUrl: "https://storage.example/upload",
    fileUrl: "https://storage.example/proofs/receipt.png",
  });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 403 })));

  await expect(
    uploadViaPresign("/orders/proof-url", new File(["receipt"], "receipt.png")),
  ).rejects.toThrow("Upload failed");
});
