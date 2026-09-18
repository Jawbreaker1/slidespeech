import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { prepareTunnelFiles, tunnelArguments } from "./private-tunnel-config";

async function main() {
  const response = await fetch("http://127.0.0.1:3000/api/generation-v2/presentations?limit=1", { signal: AbortSignal.timeout(5000) });
  if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) {
    throw new Error("Start the current web build and API first. The web server must serve /api on the same origin.");
  }
  const { credentialsPath, policyPath } = await prepareTunnelFiles(resolve(".local/ngrok"));
  console.log(`Private login details: ${credentialsPath}. Share them separately from the HTTPS URL. Stop this process to close access.`);
  const child = spawn("ngrok", tunnelArguments(policyPath), { stdio: "inherit" });
  const stop = () => { child.kill("SIGTERM"); };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  child.once("error", () => { console.error("Could not start ngrok. Install it and configure your account first."); process.exitCode = 1; });
  child.once("exit", (code) => {
    process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop);
    process.exitCode = code ?? 1;
  });
}

void main().catch((error) => { console.error(error instanceof Error ? error.message : "Private tunnel could not start."); process.exitCode = 1; });
