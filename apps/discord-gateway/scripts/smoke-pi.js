import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config.js";
import { PiSessionPool } from "../src/pi-session.js";

const config = loadConfig();
const root = await mkdtemp(join(tmpdir(), "m2pi-gateway-smoke-"));
const pool = new PiSessionPool({
  modelName: config.model,
  cwd: config.cwd,
  agentDir: config.agentDir,
  allowedTools: config.allowedTools,
  sessionRoot: root,
});
try {
  const text = await pool.prompt(
    "smoke-test",
    "Reply with exactly PI_GATEWAY_OK and nothing else.",
  );
  console.log(text);
  if (text.trim() !== "PI_GATEWAY_OK") process.exitCode = 1;
} finally {
  await pool.dispose();
}
