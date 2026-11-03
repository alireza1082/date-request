/** Bounded recovery for idempotent public reads only; never use for writes. */
export class PublicReadError extends Error {
  constructor(readonly status: number | null) {
    super("Public data is unavailable");
  }
}
const pending = new Map<string, Promise<unknown>>();
const retryable = new Set([408, 500, 502, 503, 504]);

export function readPublicJson(path: string, maxBytes: number): Promise<unknown> {
  const previous = pending.get(path);
  if (previous) return previous;
  const request = readWithRecovery(path, maxBytes).finally(() => {
    if (pending.get(path) === request) pending.delete(path);
  });
  pending.set(path, request);
  return request;
}

async function readWithRecovery(path: string, maxBytes: number): Promise<unknown> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 4000);
    try {
      const response = await fetch(path, {
        method: "GET", credentials: "same-origin", cache: "no-store", redirect: "error",
        signal: controller.signal, headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new PublicReadError(response.status);
      const body = await response.text();
      if (new TextEncoder().encode(body).byteLength > maxBytes) throw new PublicReadError(413);
      // A valid HTTP response with malformed/incompatible data is not transient.
      try { return JSON.parse(body) as unknown; }
      catch { throw new PublicReadError(422); }
    } catch (error) {
      if (attempt === 1 || (error instanceof PublicReadError && (error.status === null || !retryable.has(error.status)))) throw error;
    } finally { window.clearTimeout(timer); }
    await new Promise<void>(resolve => window.setTimeout(resolve, 250));
  }
  throw new PublicReadError(null);
}
