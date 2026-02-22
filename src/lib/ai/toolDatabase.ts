import * as fs from "fs";
import * as path from "path";

/**
 * Unified async tool database — uses the SAME backend as the main storage.
 *
 * Driver resolution reads root config.json and environment variables
 * identically to StorageFactory, so there is exactly one DB file / server
 * across the entire project.
 *
 * SQLite  → same .sqlite file (better-sqlite3, sync wrapped in async)
 * MySQL / MariaDB → same pool (mysql2/promise)
 *
 * Tools declare their DDL in `tableSchema` (IF NOT EXISTS, idempotent).
 * Note: tool DDL should target the configured dialect. The default examples
 * use SQLite syntax; MySQL users must provide MySQL-compatible DDL.
 */

type Driver = "sqlite" | "mysql";

function loadConfig(): any {
  try {
    return JSON.parse(fs.readFileSync(path.join(process.cwd(), "config.json"), "utf-8"));
  } catch {
    return {};
  }
}

function resolveDriver(): { driver: Driver; sqlitePath?: string; mysql?: any } {
  const cfg = loadConfig();
  const driver = (
    process.env.DB_DRIVER || cfg.storage?.driver || "sqlite"
  ).toLowerCase() as Driver;

  if (driver === "sqlite") {
    return {
      driver: "sqlite",
      sqlitePath: process.env.DB_PATH || cfg.storage?.sqlite?.path || "data/db.sqlite",
    };
  }

  return {
    driver: "mysql",
    mysql: {
      host: process.env.DB_HOST || cfg.storage?.mysql?.host || "localhost",
      port: Number(process.env.DB_PORT || cfg.storage?.mysql?.port || 3306),
      user: process.env.DB_USER || cfg.storage?.mysql?.user || "",
      password: process.env.DB_PASS || cfg.storage?.mysql?.password || "",
      database: process.env.DB_NAME || cfg.storage?.mysql?.database || "mjxassistant",
    },
  };
}

export class ToolDatabase {
  private driver: Driver;
  private sqliteDb: any; // better-sqlite3 Database
  private mysqlPool: any; // mysql2 Pool

  constructor() {
    const resolved = resolveDriver();
    this.driver = resolved.driver;

    if (resolved.driver === "sqlite") {
      const Database = require("better-sqlite3");
      const absPath = path.join(process.cwd(), resolved.sqlitePath!);
      fs.mkdirSync(path.dirname(absPath), { recursive: true });
      this.sqliteDb = new Database(absPath);
      this.sqliteDb.pragma("journal_mode = WAL");
      this.sqliteDb.pragma("foreign_keys = ON");
      console.log(`✓ ToolDatabase: SQLite (${resolved.sqlitePath}) — shared with main storage`);
    } else {
      try {
        const mysql = require("mysql2/promise");
        this.mysqlPool = mysql.createPool({
          ...resolved.mysql,
          waitForConnections: true,
          connectionLimit: 5,
        });
        console.log(`✓ ToolDatabase: MySQL ${resolved.mysql?.host}/${resolved.mysql?.database} — shared with main storage`);
      } catch {
        throw new Error("mysql2 is not installed. Run: npm install mysql2");
      }
    }
  }

  /** Create a table. DDL must use IF NOT EXISTS. */
  async createTable(ddl: string): Promise<void> {
    if (this.driver === "sqlite") {
      this.sqliteDb.prepare(ddl).run();
    } else {
      await this.mysqlPool.execute(ddl);
    }
  }

  /** Query rows. */
  async query<T = Record<string, any>>(sql: string, params: any[] = []): Promise<T[]> {
    if (this.driver === "sqlite") {
      return this.sqliteDb.prepare(sql).all(...params) as T[];
    }
    const [rows] = await this.mysqlPool.execute(sql, params);
    return rows as T[];
  }

  /** Execute INSERT / UPDATE / DELETE. */
  async run(
    sql: string,
    params: any[] = []
  ): Promise<{ changes: number; lastInsertRowid: number | bigint }> {
    if (this.driver === "sqlite") {
      const r = this.sqliteDb.prepare(sql).run(...params);
      return { changes: r.changes, lastInsertRowid: r.lastInsertRowid };
    }
    const [result] = await this.mysqlPool.execute(sql, params);
    return {
      changes: (result as any).affectedRows,
      lastInsertRowid: (result as any).insertId,
    };
  }

  /** Fetch a single row or null. */
  async get<T = Record<string, any>>(sql: string, params: any[] = []): Promise<T | null> {
    if (this.driver === "sqlite") {
      return (this.sqliteDb.prepare(sql).get(...params) as T) ?? null;
    }
    const [rows] = await this.mysqlPool.execute(sql, params);
    return ((rows as any[])[0] as T) ?? null;
  }
}

/** Singleton — created once, shared across all tools. */
export const toolDatabase = new ToolDatabase();
