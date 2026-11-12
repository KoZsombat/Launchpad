import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import fs from "node:fs";
import path from "node:path";
import { config } from "../config";
import * as schema from "./schema";

fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });

const sqlite = new Database(config.databasePath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");
sqlite.pragma("busy_timeout = 5000");

export const db = drizzle(sqlite, { schema });

export function runMigrations(): void {
  migrate(db, { migrationsFolder: config.migrationsDir });
}

export { sqlite };
