import { lookup } from "node:dns/promises";
import type { LookupFunction } from "node:net";
import ipaddr from "ipaddr.js";
import { Agent } from "undici";

export function isPublicResearchAddress(address: string): boolean {
  if (!ipaddr.isValid(address)) return false;
  return ipaddr.process(address).range() === "unicast";
}

// This is the socket's resolver, not a preflight followed by a second DNS lookup.
export function createPublicResearchLookup(resolve = lookup): LookupFunction {
  return (hostname, options, callback) => {
    void resolve(hostname, { all: true, verbatim: true }).then((addresses) => {
      if (!addresses.length || addresses.some(({ address }) => !isPublicResearchAddress(address))) {
        callback(new Error("Research destination must resolve exclusively to public addresses."), "", 4);
        return;
      }
      if (options.all) callback(null, addresses);
      else callback(null, addresses[0]!.address, addresses[0]!.family);
    }, (error: Error) => callback(error, "", 4));
  };
}

const dispatcher = new Agent({ connect: { lookup: createPublicResearchLookup() } });

export function assertPublicResearchUrl(value: string): URL {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Only credential-free HTTP(S) research URLs are allowed.");
  const hostname = url.hostname.startsWith("[") ? url.hostname.slice(1, -1) : url.hostname;
  if (ipaddr.isValid(hostname) && !isPublicResearchAddress(hostname)) throw new Error("Non-public research destination.");
  return url;
}

export async function fetchPublicResearch(initialUrl: string, options: { signal?: AbortSignal | undefined; timeoutMs?: number; userAgent?: string } = {}): Promise<Response> {
  const timeout = AbortSignal.timeout(options.timeoutMs ?? 15_000);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  let url = assertPublicResearchUrl(initialUrl);
  for (let redirects = 0; redirects <= 5; redirects++) {
    signal.throwIfAborted();
    const response = await fetch(url, { dispatcher, redirect: "manual", signal,
      headers: { "User-Agent": options.userAgent ?? "SlideSpeechBot/0.2 (presentation research)" },
    } as RequestInit);
    const location = response.headers.get("location");
    if (response.status < 300 || response.status >= 400 || !location) return response;
    await response.body?.cancel();
    url = assertPublicResearchUrl(new URL(location, url).href);
  }
  throw new Error("Research fetch exceeded the redirect limit.");
}

export async function readBoundedResearchBytes(response: Response, limit: number): Promise<Buffer> {
  if (!response.body) throw new Error("Research response has no body.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error("Research response exceeds the byte limit.");
      chunks.push(value);
    }
    return Buffer.concat(chunks, size);
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally { reader.releaseLock(); }
}
