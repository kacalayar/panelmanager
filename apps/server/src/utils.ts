export function slugify(name: string, fallbackPrefix: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "") || `${fallbackPrefix}-${Date.now()}`
  );
}

/**
 * Checks whether a browser Origin matches the configured publicUrl, localhost dev,
 * or the exact hostname of the incoming request (blocking sibling subdomains).
 */
export function isAllowedOrigin(
  origin: string | undefined,
  publicUrl: string,
  requestHost?: string
): boolean {
  if (!origin) return false;
  let parsedOrigin: URL;
  try {
    parsedOrigin = new URL(origin);
  } catch {
    return false;
  }

  try {
    if (parsedOrigin.origin === new URL(publicUrl).origin) {
      return true;
    }
  } catch {
    // ignore malformed publicUrl
  }

  if (
    parsedOrigin.origin === "http://localhost:3000" ||
    parsedOrigin.origin === "http://127.0.0.1:3000"
  ) {
    return true;
  }

  if (requestHost) {
    const reqHostname = requestHost.split(":")[0].toLowerCase();
    const originHost = parsedOrigin.hostname.toLowerCase();
    if (originHost === reqHostname && (parsedOrigin.port === "3000" || parsedOrigin.host === requestHost)) {
      return true;
    }
  }

  return false;
}
