import { afterEach, describe, expect, it, vi } from "vitest";
import { adminRequest, getAdminCsrf, loginAdmin } from "./admin-api";

afterEach(() => vi.unstubAllGlobals());

describe("admin API security client", () => {
  it("uses same-origin cookies and keeps the login CSRF token in memory", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ csrf_token: "challenge" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ authenticated: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const challenge = await getAdminCsrf();
    await loginAdmin("long admin password", challenge.csrf_token);

    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ credentials: "same-origin", cache: "no-store" });
    expect((fetchMock.mock.calls[1]?.[1] as RequestInit).headers).toBeInstanceOf(Headers);
    expect(((fetchMock.mock.calls[1]?.[1] as RequestInit).headers as Headers).get("X-CSRF-Token")).toBe("challenge");
    expect(((fetchMock.mock.calls[1]?.[1] as RequestInit).headers as Headers).get("Content-Type")).toBe("application/json");
    expect(localStorage.length).toBe(0);
  });

  it("signals session expiry to the protected admin shell", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: "Authentication required." }), { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    const onExpired = vi.fn();
    window.addEventListener("datewheel:admin-unauthorized", onExpired);
    await expect(adminRequest("/api/admin/activities")).rejects.toMatchObject({ status: 401 });
    expect(onExpired).toHaveBeenCalledOnce();
    window.removeEventListener("datewheel:admin-unauthorized", onExpired);
  });
});
