import type { RequestHandler } from "express";

export function allowsBrowserWrite(method: string, origin: string | undefined, fetchSite: string | undefined, host: string | undefined): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(method)) return true;
  if (fetchSite === "cross-site") return false;
  if (origin === undefined) return true; // Local CLI clients do not send Origin.
  try {
    const url = new URL(origin);
    return ["http:", "https:"].includes(url.protocol) && url.origin === origin && url.host === host?.toLowerCase();
  } catch { return false; }
}

export const requireSameOriginWrite: RequestHandler = (request, response, next) => {
  // Next's same-origin proxy overwrites this header. The API binds to loopback.
  const host = request.get("x-forwarded-host") ?? request.get("host");
  if (!allowsBrowserWrite(request.method, request.get("origin"), request.get("sec-fetch-site"), host)) {
    response.status(403).json({ error: "Cross-site changes are not allowed." });
    return;
  }
  next();
};
