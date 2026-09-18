import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

type Credentials = { username: string; password: string };

export function tunnelPolicy(credentials: Credentials) {
  if (!credentials || typeof credentials.username !== "string" || !credentials.username || credentials.username.includes(":") ||
      typeof credentials.password !== "string" || credentials.password.length < 16 || credentials.password.length > 128) {
    throw new Error("Private tunnel credentials require a username without colons and a 16-128 character password.");
  }
  return { on_http_request: [{ actions: [
    { type: "basic-auth", config: { realm: "SlideSpeech friends", credentials: [`${credentials.username}:${credentials.password}`], enforce: true } },
  ] }] };
}

export async function prepareTunnelFiles(directory: string) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const credentialsPath = join(directory, "access.json");
  try {
    await writeFile(credentialsPath, JSON.stringify({ username: "friends", password: randomBytes(24).toString("base64url") }, null, 2), { flag: "wx", mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  await chmod(credentialsPath, 0o600);
  let credentials: Credentials;
  try { credentials = JSON.parse(await readFile(credentialsPath, "utf8")); }
  catch { throw new Error("Private login file could not be read as JSON. Correct it before starting the tunnel."); }
  const policy = tunnelPolicy(credentials);
  const policyPath = join(directory, "traffic-policy.json");
  await writeFile(policyPath, JSON.stringify(policy, null, 2), { mode: 0o600 });
  await chmod(policyPath, 0o600);
  return { credentialsPath, policyPath };
}

export function tunnelArguments(policyPath: string) {
  return ["http", "http://127.0.0.1:3000", "--name=slidespeech-friends", `--traffic-policy-file=${policyPath}`, "--inspect=false", "--log=stdout", "--log-format=json"];
}
