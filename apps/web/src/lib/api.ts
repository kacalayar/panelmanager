export function getAuthToken(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem("panel_token") || "";
}

export function setAuthToken(token: string) {
  if (typeof window !== "undefined") {
    localStorage.setItem("panel_token", token);
  }
}

export function clearAuthToken() {
  if (typeof window !== "undefined") {
    localStorage.removeItem("panel_token");
  }
}

export function getWsBaseUrl(): string {
  if (typeof window === "undefined") return "ws://localhost:3001";
  const configured = process.env.NEXT_PUBLIC_API_URL;
  if (configured) {
    return configured.replace(/^http/, "ws").replace(/\/$/, "");
  }
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.hostname}:3001`;
}

export async function apiFetch<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getAuthToken();
  const headers = new Headers(init.headers || {});
  if (!headers.has("Content-Type") && init.body && typeof init.body === "string") {
    headers.set("Content-Type", "application/json");
  }
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const res = await fetch(path, {
    ...init,
    headers,
    credentials: "include",
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(
      typeof errBody.error === "string" ? errBody.error : JSON.stringify(errBody.error || res.statusText)
    );
  }

  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return (await res.json()) as T;
  }
  return (await res.text()) as unknown as T;
}
