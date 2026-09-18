import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import nextConfig from "../apps/web/next.config";
import { NextRequest } from "next/server";
import { middleware } from "../apps/web/middleware";
import { allowsBrowserWrite } from "../apps/api/src/lib/browser-request-origin";
import { prepareTunnelFiles, tunnelArguments, tunnelPolicy } from "../scripts/private-tunnel-config";

test("private tunnel protects every path before forwarding and never puts credentials in arguments", () => {
  const policy = tunnelPolicy({ username: "test", password: "a-strong-test-password" });
  assert.equal(policy.on_http_request.length, 1);
  assert.equal("expressions" in policy.on_http_request[0]!, false);
  assert.deepEqual(policy.on_http_request[0]!.actions, [
    { type: "basic-auth", config: { realm: "SlideSpeech friends", credentials: ["test:a-strong-test-password"], enforce: true } },
  ]);
  const args = tunnelArguments("/private/policy.json");
  assert.ok(args.includes("--inspect=false"));
  assert.ok(args.includes("--traffic-policy-file=/private/policy.json"));
  assert.equal(args.some((arg) => arg.includes("a-strong-test-password")), false);
  assert.throws(() => tunnelPolicy({ username: "test", password: "short" }));
  assert.throws(() => tunnelPolicy({ username: "test:wrong", password: "a-strong-test-password" }));
});

test("web strips the login header after tunnel authentication, preserving request context", () => {
  const response = middleware(new NextRequest("http://localhost:3000/api/generation-v2/jobs", {
    headers: { authorization: "Basic test-secret", origin: "https://demo.ngrok.app", accept: "application/json" },
  }));
  assert.equal(response.headers.get("x-middleware-request-authorization"), null);
  assert.equal(response.headers.get("x-middleware-override-headers")?.includes("authorization"), false);
  assert.equal(response.headers.get("x-middleware-request-origin"), "https://demo.ngrok.app");
  assert.equal(response.headers.get("x-middleware-request-accept"), "application/json");
});

test("private credentials persist with restrictive permissions and invalid configuration fails closed", async () => {
  const directory = await mkdtemp(join(tmpdir(), "slidespeech-tunnel-"));
  try {
    const first = await prepareTunnelFiles(directory);
    const credentials = JSON.parse(await readFile(first.credentialsPath, "utf8"));
    assert.equal(credentials.password.length, 32);
    assert.equal((await stat(first.credentialsPath)).mode & 0o777, 0o600);
    assert.equal((await stat(first.policyPath)).mode & 0o777, 0o600);
    assert.equal((await stat(directory)).mode & 0o777, 0o700);
    await prepareTunnelFiles(directory);
    assert.deepEqual(JSON.parse(await readFile(first.credentialsPath, "utf8")), credentials);
    assert.deepEqual(JSON.parse(await readFile(first.policyPath, "utf8")), tunnelPolicy(credentials));
    await writeFile(first.credentialsPath, JSON.stringify({ username: "test", password: "short" }));
    await assert.rejects(prepareTunnelFiles(directory));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("web proxies all API paths on the same origin with time for queued questions", async () => {
  assert.deepEqual(await nextConfig.rewrites!(), [{ source: "/api/:path*", destination: `${process.env.SLIDESPEECH_API_ORIGIN ?? "http://127.0.0.1:4000"}/api/:path*` }]);
  assert.ok(nextConfig.experimental!.proxyTimeout! > 180_000 + 120_000);
});

test("browser writes require the web origin but local CLI and read requests still work", () => {
  assert.equal(allowsBrowserWrite("POST", "https://demo.ngrok.app", "same-origin", "demo.ngrok.app"), true);
  assert.equal(allowsBrowserWrite("POST", "http://localhost:3000", "same-origin", "localhost:3000"), true);
  assert.equal(allowsBrowserWrite("POST", undefined, undefined, "localhost:4000"), true);
  assert.equal(allowsBrowserWrite("GET", "https://unrelated.example", "cross-site", "demo.ngrok.app"), true);
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    assert.equal(allowsBrowserWrite(method, "https://unrelated.example", "cross-site", "demo.ngrok.app"), false);
    assert.equal(allowsBrowserWrite(method, "https://unrelated.example", "same-site", "demo.ngrok.app"), false);
    assert.equal(allowsBrowserWrite(method, undefined, "cross-site", "demo.ngrok.app"), false);
    assert.equal(allowsBrowserWrite(method, "null", undefined, "demo.ngrok.app"), false);
    assert.equal(allowsBrowserWrite(method, "not-a-url", undefined, "demo.ngrok.app"), false);
  }
});
