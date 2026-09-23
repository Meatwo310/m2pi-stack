import { ConfigStore } from "../src/config-store.js";
import {
  defaultDatabasePath,
  defaultRuntimeConfig,
} from "../src/config.js";

const [, , command = "show", ...args] = process.argv;
const databasePath = process.env.M2PI_DATABASE_PATH || defaultDatabasePath();
const store = new ConfigStore(databasePath);

try {
  if (command === "init") {
    if (args.length === 0) {
      throw new Error("Usage: config-db.js init <Discord user ID> [additional user IDs...]");
    }
    store.initialize(defaultRuntimeConfig(), new Set(args));
    console.log(`initialized ${databasePath}`);
  } else if (command === "show") {
    const current = store.read();
    console.log(JSON.stringify({
      databasePath,
      model: current.model,
      cwd: current.cwd,
      agentDir: current.agentDir,
      sessionRoot: current.sessionRoot,
      allowedTools: current.allowedTools,
      allowedUserIds: [...current.allowedUserIds],
      updatedAt: current.updatedAt,
    }, null, 2));
  } else if (command === "set") {
    const [key, ...valueParts] = args;
    if (!key || valueParts.length === 0) {
      throw new Error("Usage: config-db.js set <key> <value>");
    }
    store.set(key, valueParts.join(" "));
    console.log(`updated ${key}`);
  } else if (command === "allow-user") {
    if (args.length !== 1) throw new Error("Usage: config-db.js allow-user <Discord user ID>");
    store.allowUser(args[0]);
    console.log(`allowed user ${args[0]}`);
  } else if (command === "deny-user") {
    if (args.length !== 1) throw new Error("Usage: config-db.js deny-user <Discord user ID>");
    store.denyUser(args[0]);
    console.log(`denied user ${args[0]}`);
  } else {
    throw new Error("Commands: init, show, set, allow-user, deny-user");
  }
} finally {
  store.close();
}
