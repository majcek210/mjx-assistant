import Database from "better-sqlite3";
import * as path from "path";

/**
 * Lightweight SQLite database for tool-specific data.
 *
 * Tools declare their own tables via `tableSchema` in the Tool interface.
 * ToolExecutor calls `createTable()` for each schema entry during initialization,
 * then passes this instance to `tool.init(db)` so tools can store a reference.
 *
 * Kept separate from the model storage (db.sqlite) to avoid schema coupling.
 */
export class ToolDatabase {
  private db: Database.Database;

  constructor(dbPath = "tools.db") {
    this.db = new Database(path.join(process.cwd(), dbPath));
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
  }

  /** Run a DDL statement to create a table (idempotent via IF NOT EXISTS). */
  createTable(ddl: string): void {
    this.db.prepare(ddl).run();
  }

  /** Query rows. Returns typed array. */
  query<T = Record<string, any>>(sql: string, params: any[] = []): T[] {
    return this.db.prepare(sql).all(...params) as T[];
  }

  /** Execute INSERT / UPDATE / DELETE. Returns affected rows and last insert id. */
  run(sql: string, params: any[] = []): { changes: number; lastInsertRowid: number | bigint } {
    const result = this.db.prepare(sql).run(...params);
    return { changes: result.changes, lastInsertRowid: result.lastInsertRowid };
  }

  /** Fetch a single row or null. */
  get<T = Record<string, any>>(sql: string, params: any[] = []): T | null {
    return (this.db.prepare(sql).get(...params) as T) ?? null;
  }
}

/** Singleton instance shared across all tools. */
export const toolDatabase = new ToolDatabase();
