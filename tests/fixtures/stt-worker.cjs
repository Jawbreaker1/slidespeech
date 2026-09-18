const readline = require("node:readline");
const mode = process.argv[2];
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const request = JSON.parse(line);
  if (mode === "hang") return;
  if (mode === "malformed") { process.stdout.write("not json\n"); return; }
  const payload = request.action === "health" ? { ready: true } : { text: "Test transcript", confidence: null, isFinal: true };
  const send = () => process.stdout.write(JSON.stringify({ id: request.id, ok: true, payload }) + "\n");
  if (mode === "slow" && request.action !== "health") setTimeout(send, 1000); else send();
});
