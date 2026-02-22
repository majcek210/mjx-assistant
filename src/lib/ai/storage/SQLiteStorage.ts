import Database from "better-sqlite3";
import * as fs from "fs";
import * as nodePath from "path";
import { IStorage, Model, ModelUsage, TaskLog } from "./IStorage";

/**
 * SQLite storage adapter.
 * Uses better-sqlite3 (synchronous) wrapped in async interface.
 */
export class SQLiteStorage implements IStorage {
  private db: Database.Database;

  constructor(path = "data/db.sqlite") {
    fs.mkdirSync(nodePath.dirname(nodePath.resolve(path)), { recursive: true });
    this.db = new Database(path);
    this.createTables();
    this.migrateDatabase();
    this.cleanupOldLogs();
  }

  private createTables() {
    this.db.prepare(`
      CREATE TABLE IF NOT EXISTS models (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        model TEXT NOT NULL UNIQUE,
        origin TEXT NOT NULL,
        rank INTEGER NOT NULL DEFAULT 0,
        description TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        rpm_allowed INTEGER NOT NULL DEFAULT 0,
        tpm_total INTEGER NOT NULL DEFAULT 0,
        rpd_total INTEGER NOT NULL DEFAULT 0,
        tpd_total INTEGER NOT NULL DEFAULT 0,
        successful_tasks INTEGER NOT NULL DEFAULT 0,
        failed_tasks INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
        updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
      );
    `).run();

    this.db.prepare(`
      CREATE TABLE IF NOT EXISTS usage_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        model TEXT NOT NULL,
        requests INTEGER NOT NULL DEFAULT 1,
        tokens INTEGER NOT NULL DEFAULT 0,
        timestamp INTEGER NOT NULL DEFAULT (strftime('%s','now')),
        FOREIGN KEY(model) REFERENCES models(model) ON DELETE CASCADE
      );
    `).run();

    this.db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_usage_logs_timestamp
      ON usage_logs(timestamp);
    `).run();

    this.db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_usage_logs_model_timestamp
      ON usage_logs(model, timestamp);
    `).run();

    this.db.prepare(`
      CREATE TABLE IF NOT EXISTS task_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        model TEXT NOT NULL,
        task_type TEXT NOT NULL,
        success INTEGER NOT NULL,
        error_message TEXT,
        tokens_used INTEGER NOT NULL DEFAULT 0,
        timestamp INTEGER NOT NULL DEFAULT (strftime('%s','now')),
        FOREIGN KEY(model) REFERENCES models(model) ON DELETE CASCADE
      );
    `).run();

    this.db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_task_logs_model_success
      ON task_logs(model, success);
    `).run();

    this.db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_task_logs_timestamp
      ON task_logs(timestamp);
    `).run();

    console.log("✓ SQLite: tables and indexes ready");
  }

  private migrateDatabase() {
    const tableInfo: any[] = this.db.prepare(`PRAGMA table_info(models)`).all();
    const columns = tableInfo.map((col) => col.name);

    if (!columns.includes("successful_tasks")) {
      this.db
        .prepare(
          `ALTER TABLE models ADD COLUMN successful_tasks INTEGER NOT NULL DEFAULT 0`
        )
        .run();
    }

    if (!columns.includes("failed_tasks")) {
      this.db
        .prepare(
          `ALTER TABLE models ADD COLUMN failed_tasks INTEGER NOT NULL DEFAULT 0`
        )
        .run();
    }
  }

  async seedModels(models: Model[]): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO models (model, origin, rank, description, enabled, rpm_allowed, tpm_total, rpd_total, tpd_total, updated_at)
      VALUES (@name, @origin, @rank, @description, @enabled, @rpmAllowed, @tpmTotal, @rpdTotal, @tpdTotal, @updatedAt)
      ON CONFLICT(model) DO UPDATE SET
        origin = excluded.origin,
        rank = excluded.rank,
        description = excluded.description,
        enabled = excluded.enabled,
        rpm_allowed = excluded.rpm_allowed,
        tpm_total = excluded.tpm_total,
        rpd_total = excluded.rpd_total,
        tpd_total = excluded.tpd_total,
        updated_at = excluded.updated_at
    `);

    const tx = this.db.transaction((rows: Model[]) => {
      for (const row of rows) {
        if (
          row.rpmAllowed === undefined ||
          row.tpmTotal === undefined ||
          row.rpdTotal === undefined
        ) {
          console.error("⚠ Missing limits in row, skipping:", row);
          continue;
        }
        stmt.run({
          name: row.name,
          origin: row.origin,
          rank: row.rank,
          description: row.description,
          enabled: row.enabled ? 1 : 0,
          rpmAllowed: row.rpmAllowed,
          tpmTotal: row.tpmTotal,
          rpdTotal: row.rpdTotal,
          tpdTotal: row.tpdTotal ?? row.tpmTotal * 1440,
          updatedAt: Math.floor(Date.now() / 1000),
        });
      }
    });

    tx(models);
    console.log(`✓ Seeded ${models.length} models`);
  }

  async enableModel(name: string): Promise<void> {
    this.db
      .prepare(`UPDATE models SET enabled = 1, updated_at = ? WHERE model = ?`)
      .run(Math.floor(Date.now() / 1000), name);
  }

  async disableModel(name: string): Promise<void> {
    this.db
      .prepare(`UPDATE models SET enabled = 0, updated_at = ? WHERE model = ?`)
      .run(Math.floor(Date.now() / 1000), name);
  }

  async logModelUsage(model: string, requests = 1, tokens = 0): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    this.db
      .prepare(
        `INSERT INTO usage_logs (model, requests, tokens, timestamp) VALUES (?, ?, ?, ?)`
      )
      .run(model, requests, tokens, now);
  }

  async getModelUsage(model: string): Promise<ModelUsage> {
    const now = Math.floor(Date.now() / 1000);
    const oneMinuteAgo = now - 60;
    const oneDayAgo = now - 86400;

    const minuteUsage: any = this.db
      .prepare(
        `SELECT IFNULL(SUM(requests),0) as rpm_used, IFNULL(SUM(tokens),0) as tpm_used
         FROM usage_logs WHERE model = ? AND timestamp >= ?`
      )
      .get(model, oneMinuteAgo);

    const dayUsage: any = this.db
      .prepare(
        `SELECT IFNULL(SUM(requests),0) as rpd_used, IFNULL(SUM(tokens),0) as tpd_used
         FROM usage_logs WHERE model = ? AND timestamp >= ?`
      )
      .get(model, oneDayAgo);

    return {
      model,
      rpmUsed: minuteUsage.rpm_used,
      tpmUsed: minuteUsage.tpm_used,
      rpdUsed: dayUsage.rpd_used,
      tpdUsed: dayUsage.tpd_used,
    };
  }

  async cleanupOldLogs(): Promise<number> {
    const oneDayAgo = Math.floor(Date.now() / 1000) - 86400;
    const result = this.db
      .prepare(`DELETE FROM usage_logs WHERE timestamp < ?`)
      .run(oneDayAgo);
    if (result.changes > 0) {
      console.log(`✓ Cleaned ${result.changes} old usage logs`);
    }
    return result.changes;
  }

  async getAllAvailableModels(minTokens = 400): Promise<Model[]> {
    const now = Math.floor(Date.now() / 1000);
    const oneMinuteAgo = now - 60;
    const oneDayAgo = now - 86400;

    const rows = this.db
      .prepare(
        `SELECT
          m.model as name, m.origin, m.rank, m.description, m.enabled,
          m.rpm_allowed, m.tpm_total, m.rpd_total, m.tpd_total,
          IFNULL((SELECT SUM(requests) FROM usage_logs WHERE model = m.model AND timestamp >= ?), 0) as rpm_used,
          IFNULL((SELECT SUM(tokens)   FROM usage_logs WHERE model = m.model AND timestamp >= ?), 0) as tpm_used,
          IFNULL((SELECT SUM(requests) FROM usage_logs WHERE model = m.model AND timestamp >= ?), 0) as rpd_used,
          IFNULL((SELECT SUM(tokens)   FROM usage_logs WHERE model = m.model AND timestamp >= ?), 0) as tpd_used
        FROM models m WHERE m.enabled = 1 ORDER BY m.rank ASC`
      )
      .all(oneMinuteAgo, oneMinuteAgo, oneDayAgo, oneDayAgo);

    return (rows as any[])
      .filter((r) => {
        return (
          r.rpm_allowed - r.rpm_used >= 1 &&
          r.tpm_total - r.tpm_used >= minTokens &&
          r.rpd_total - r.rpd_used >= 1 &&
          r.tpd_total - r.tpd_used >= minTokens
        );
      })
      .map((r) => ({
        name: r.name,
        origin: r.origin,
        rank: r.rank,
        description: r.description,
        enabled: r.enabled === 1,
        rpmAllowed: r.rpm_allowed,
        tpmTotal: r.tpm_total,
        rpdTotal: r.rpd_total,
        tpdTotal: r.tpd_total,
      }));
  }

  async getModelStats(): Promise<Array<Model & ModelUsage>> {
    const models = this.db
      .prepare(
        `SELECT model, origin, rank, description, enabled,
                rpm_allowed, tpm_total, rpd_total, tpd_total,
                successful_tasks, failed_tasks
         FROM models ORDER BY rank ASC`
      )
      .all() as any[];

    return Promise.all(
      models.map(async (m) => {
        const usage = await this.getModelUsage(m.model);
        return {
          name: m.model,
          origin: m.origin,
          rank: m.rank,
          description: m.description,
          enabled: m.enabled === 1,
          rpmAllowed: m.rpm_allowed,
          tpmTotal: m.tpm_total,
          rpdTotal: m.rpd_total,
          tpdTotal: m.tpd_total,
          successfulTasks: m.successful_tasks,
          failedTasks: m.failed_tasks,
          ...usage,
        };
      })
    );
  }

  async logTaskOutcome(
    model: string,
    taskType: string,
    success: boolean,
    tokensUsed: number,
    errorMessage?: string
  ): Promise<void> {
    const now = Math.floor(Date.now() / 1000);

    this.db
      .prepare(
        `INSERT INTO task_logs (model, task_type, success, error_message, tokens_used, timestamp)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(model, taskType, success ? 1 : 0, errorMessage || null, tokensUsed, now);

    if (success) {
      this.db
        .prepare(
          `UPDATE models SET successful_tasks = successful_tasks + 1, updated_at = ? WHERE model = ?`
        )
        .run(now, model);
    } else {
      this.db
        .prepare(
          `UPDATE models SET failed_tasks = failed_tasks + 1, updated_at = ? WHERE model = ?`
        )
        .run(now, model);
    }
  }

  async getModelFailureRate(
    model: string,
    timeWindowSeconds = 86400
  ): Promise<number> {
    const sinceTimestamp = Math.floor(Date.now() / 1000) - timeWindowSeconds;

    const stats: any = this.db
      .prepare(
        `SELECT COUNT(*) as total_tasks,
                SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failed_tasks
         FROM task_logs WHERE model = ? AND timestamp >= ?`
      )
      .get(model, sinceTimestamp);

    if (!stats || stats.total_tasks === 0) return 0;
    return (stats.failed_tasks / stats.total_tasks) * 100;
  }

  async getRecentFailedTasks(model: string, limit = 10): Promise<TaskLog[]> {
    return this.db
      .prepare(
        `SELECT id, model, task_type as taskType, success,
                error_message as errorMessage, tokens_used as tokensUsed, timestamp
         FROM task_logs WHERE model = ? AND success = 0
         ORDER BY timestamp DESC LIMIT ?`
      )
      .all(model, limit) as TaskLog[];
  }

  async cleanupOldTaskLogs(daysToKeep = 7): Promise<number> {
    const cutoff = Math.floor(Date.now() / 1000) - daysToKeep * 86400;
    const result = this.db
      .prepare(`DELETE FROM task_logs WHERE timestamp < ?`)
      .run(cutoff);
    if (result.changes > 0) {
      console.log(`✓ Cleaned ${result.changes} old task logs (>${daysToKeep} days)`);
    }
    return result.changes;
  }
}
