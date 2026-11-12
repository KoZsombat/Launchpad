import http from "node:http";
import { config } from "./config";
import { runMigrations } from "./db";
import { seedAdminUser } from "./auth";
import { createApp } from "./app";
import { failStaleDeployments } from "./services/deployments";
import { attachTerminalServer } from "./terminal";

async function main(): Promise<void> {
  runMigrations();
  await seedAdminUser();
  const stale = failStaleDeployments();
  if (stale > 0) {
    console.warn(`Marked ${stale} in-flight deployment(s) as failed after restart.`);
  }

  const app = createApp();
  const server = http.createServer(app);
  attachTerminalServer(server);

  server.listen(config.port, () => {
    console.log(`Launchpad listening on http://0.0.0.0:${config.port}`);
    console.log(`Panel URL: ${config.panelUrl}`);
  });
}

main().catch((error) => {
  console.error("Failed to start Launchpad:", error);
  process.exit(1);
});
