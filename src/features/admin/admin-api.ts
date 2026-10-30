export class AdminApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "AdminApiError";
  }
}

interface CsrfResponse { readonly csrf_token: string }
interface SessionResponse { readonly authenticated: boolean }

async function decode<T>(response: Response): Promise<T> {
  let payload: unknown = null;
  if (response.status !== 204) {
    try { payload = await response.json(); } catch { payload = null; }
  }
  if (!response.ok) {
    const detail = typeof payload === "object" && payload !== null && "detail" in payload && typeof payload.detail === "string"
      ? payload.detail : "ارتباط با پنل مدیریت برقرار نشد.";
    throw new AdminApiError(response.status, detail);
  }
  return payload as T;
}

export async function adminRequest<T>(path: string, init: RequestInit = {}, csrfToken?: string): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (csrfToken) headers.set("X-CSRF-Token", csrfToken);
  const response = await fetch(path, {
    ...init,
    headers,
    credentials: "same-origin",
    cache: "no-store",
    redirect: "error",
  });
  if (response.status === 401 && path !== "/api/admin/auth/login" && path !== "/api/admin/auth/me") {
    window.dispatchEvent(new CustomEvent("datewheel:admin-unauthorized"));
  }
  return decode<T>(response);
}

export function getAdminCsrf(): Promise<CsrfResponse> {
  return adminRequest<CsrfResponse>("/api/admin/auth/csrf");
}

export function getAdminSession(): Promise<SessionResponse> {
  return adminRequest<SessionResponse>("/api/admin/auth/me");
}

export async function loginAdmin(password: string, challenge: string): Promise<SessionResponse> {
  return adminRequest<SessionResponse>("/api/admin/auth/login", {
    method: "POST",
    body: JSON.stringify({ password }),
  }, challenge);
}

export async function logoutAdmin(csrf: string): Promise<SessionResponse> {
  return adminRequest<SessionResponse>("/api/admin/auth/logout", { method: "POST" }, csrf);
}
