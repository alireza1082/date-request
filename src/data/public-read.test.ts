import { afterEach, expect, it, vi } from "vitest";
import { readPublicJson } from "./public-read";
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
it("deduplicates concurrent reads, retries one transient failure, and refreshes later reads", async () => {
  const fetch = vi.fn().mockResolvedValueOnce(new Response("", { status: 503 }))
    .mockImplementation(() => Promise.resolve(new Response('{"ok":true}')));
  vi.stubGlobal("fetch", fetch);
  const a = readPublicJson("/test-dedupe", 100);
  expect(readPublicJson("/test-dedupe", 100)).toBe(a);
  await expect(a).resolves.toEqual({ ok: true });
  expect(fetch).toHaveBeenCalledTimes(2);
  await readPublicJson("/test-dedupe", 100);
  expect(fetch).toHaveBeenCalledTimes(3);
});
it("bounds network retries without retaining failed requests", async () => {
  const fetch = vi.fn().mockRejectedValue(new TypeError("offline"));
  vi.stubGlobal("fetch", fetch);
  await expect(readPublicJson("/test-offline", 100)).rejects.toThrow();
  expect(fetch).toHaveBeenCalledTimes(2);
});
it.each([[401, '{}'], [200, 'broken'], [200, '"oversized"']])("does not retry invalid or oversized responses (%i)", async (status, body) => {
  const fetch = vi.fn().mockResolvedValue(new Response(body, { status }));
  vi.stubGlobal("fetch", fetch);
  await expect(readPublicJson("/test-invalid", 3)).rejects.toThrow();
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("aborts both timed-out attempts and settles instead of remaining in loading", async () => {
  vi.useFakeTimers();
  const fetch = vi.fn((_path, init: RequestInit) => new Promise((_resolve, reject) => {
    init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
  }));
  vi.stubGlobal("fetch", fetch);
  const assertion = expect(readPublicJson("/test-timeout", 100)).rejects.toThrow();
  await vi.runAllTimersAsync();
  await assertion;
  expect(fetch).toHaveBeenCalledTimes(2);
});
