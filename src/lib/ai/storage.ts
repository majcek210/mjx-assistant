import Database from "better-sqlite3";

export type ModelUsage = {
  model: string;
  rpmUsed: number;
  tpmUsed: number;
  rpdUsed: number;
  tpdUsed: number;
};

export type Model = {
  name: string;
  origin: string;
  rank: number;
  description: string;
  enabled: boolean;
  rpmAllowed: number;
  tpmTotal: number;
  rpdTotal: number;
  tpdTotal?: number;
  failedTasks?: number;
  successfulTasks?: number;
};

export type UsageLog = {
  id?: number;
  model: string;
  requests: number;
  tokens: number;
  timestamp: number;
};

export type TaskLog = {
  id?: number;
  model: string;
  taskType: string;
  success: boolean;
  errorMessage?: string;
  tokensUsed: number;
  timestamp: number;
};

export class ModelStore {
  private db: Database.Database;

  constructor(path = "./db.sqlite") {
    this.db = new Database(path);
    this.createTables();
    this.migrateDatabase();
    this.cleanupOldLogs();
  }

  private createTables() {
    // Models table: stores model configuration and limits
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

    // Usage logs table: stores individual usage events with timestamps
    // This enables true sliding window tracking
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

    // Create index on timestamp for efficient time-window queries
    this.db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_usage_logs_timestamp
      ON usage_logs(timestamp);
    `).run();

    // Create index on model + timestamp for efficient per-model queries
    this.db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_usage_logs_model_timestamp
      ON usage_logs(model, timestamp);
    `).run();

    // Task logs table: stores individual task outcomes for tracking success/failure
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

    // Create index on model + success for failure rate queries
    this.db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_task_logs_model_success
      ON task_logs(model, success);
    `).run();

    // Create index on timestamp for cleanup
    this.db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_task_logs_timestamp
      ON task_logs(timestamp);
    `).run();

    console.log("✓ Database tables and indexes created");
  }

  private migrateDatabase() {
    // Check if successful_tasks and failed_tasks columns exist in models table
    const tableInfo: any[] = this.db.prepare(`PRAGMA table_info(models)`).all();
    const columns = tableInfo.map((col) => col.name);

    if (!columns.includes("successful_tasks")) {
      console.log("Migrating: Adding successful_tasks column...");
      this.db.prepare(`ALTER TABLE models ADD COLUMN successful_tasks INTEGER NOT NULL DEFAULT 0`).run();
    }

    if (!columns.includes("failed_tasks")) {
      console.log("Migrating: Adding failed_tasks column...");
      this.db.prepare(`ALTER TABLE models ADD COLUMN failed_tasks INTEGER NOT NULL DEFAULT 0`).run();
    }

    console.log("✓ Database migration complete");
  }


  seedModels(models: Model[]) {
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
          console.error("⚠️ Missing limits in row, skipping:", row);
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
          tpdTotal: row.tpdTotal ?? row.tpmTotal * 1440, // Default: tpm * minutes in day
          updatedAt: Math.floor(Date.now() / 1000),
        });
      }
    });

    tx(models);
    console.log(`✓ Seeded ${models.length} models`);
  }

  enableModel(name: string) {
    this.db.prepare(`UPDATE models SET enabled = 1, updated_at = ? WHERE model = ?`)
      .run(Math.floor(Date.now() / 1000), name);
  }

  disableModel(name: string) {
    this.db.prepare(`UPDATE models SET enabled = 0, updated_at = ? WHERE model = ?`)
      .run(Math.floor(Date.now() / 1000), name);
  }

  /**
   * Log a usage event for a model.
   * Creates a timestamped entry in usage_logs for sliding window tracking.
   */
  logModelUsage(model: string, requests = 1, tokens = 0) {
    const now = Math.floor(Date.now() / 1000);

    this.db.prepare(`
      INSERT INTO usage_logs (model, requests, tokens, timestamp)
      VALUES (?, ?, ?, ?)
    `).run(model, requests, tokens, now);
  }

  /**
   * Get current usage for a model using sliding time windows.
   * - RPM/TPM: last 60 seconds
   * - RPD/TPD: last 24 hours (86400 seconds)
   */
  getModelUsage(model: string): ModelUsage {
    const now = Math.floor(Date.now() / 1000);
    const oneMinuteAgo = now - 60;
    const oneDayAgo = now - 86400;

    // Query for minute window (RPM/TPM)
    const minuteUsage: any = this.db.prepare(`
      SELECT
        IFNULL(SUM(requests), 0) as rpm_used,
        IFNULL(SUM(tokens), 0) as tpm_used
      FROM usage_logs
      WHERE model = ? AND timestamp >= ?
    `).get(model, oneMinuteAgo);

    // Query for day window (RPD/TPD)
    const dayUsage: any = this.db.prepare(`
      SELECT
        IFNULL(SUM(requests), 0) as rpd_used,
        IFNULL(SUM(tokens), 0) as tpd_used
      FROM usage_logs
      WHERE model = ? AND timestamp >= ?
    `).get(model, oneDayAgo);

    return {
      model,
      rpmUsed: minuteUsage.rpm_used,
      tpmUsed: minuteUsage.tpm_used,
      rpdUsed: dayUsage.rpd_used,
      tpdUsed: dayUsage.tpd_used,
    };
  }

  /**
   * Clean up usage logs older than 24 hours.
   * Should be called periodically to prevent database bloat.
   */
  cleanupOldLogs(): number {
    const oneDayAgo = Math.floor(Date.now() / 1000) - 86400;

    const result = this.db.prepare(`
      DELETE FROM usage_logs WHERE timestamp < ?
    `).run(oneDayAgo);

    if (result.changes > 0) {
      console.log(`✓ Cleaned up ${result.changes} old usage logs`);
    }

    return result.changes;
  }

  /**
   * Get all models that have available capacity for the specified token count.
   * Uses sliding window queries to check real-time availability.
   * Returns models sorted by rank (lower rank = higher priority).
   */
  getAllAvailableModels(minTokens = 400): Model[] {
    const now = Math.floor(Date.now() / 1000);
    const oneMinuteAgo = now - 60;
    const oneDayAgo = now - 86400;

    // Get all enabled models with their current usage
    const rows = this.db.prepare(`
      SELECT
        m.model as name,
        m.origin,
        m.rank,
        m.description,
        m.enabled,
        m.rpm_allowed,
        m.tpm_total,
        m.rpd_total,
        m.tpd_total,
        IFNULL((
          SELECT SUM(requests) FROM usage_logs
          WHERE model = m.model AND timestamp >= ?
        ), 0) as rpm_used,
        IFNULL((
          SELECT SUM(tokens) FROM usage_logs
          WHERE model = m.model AND timestamp >= ?
        ), 0) as tpm_used,
        IFNULL((
          SELECT SUM(requests) FROM usage_logs
          WHERE model = m.model AND timestamp >= ?
        ), 0) as rpd_used,
        IFNULL((
          SELECT SUM(tokens) FROM usage_logs
          WHERE model = m.model AND timestamp >= ?
        ), 0) as tpd_used
      FROM models m
      WHERE m.enabled = 1
      ORDER BY m.rank ASC
    `).all(oneMinuteAgo, oneMinuteAgo, oneDayAgo, oneDayAgo);

    // Filter models that have available capacity
    return rows
      .filter((r: any) => {
        const rpmAvailable = r.rpm_allowed - r.rpm_used;
        const tpmAvailable = r.tpm_total - r.tpm_used;
        const rpdAvailable = r.rpd_total - r.rpd_used;
        const tpdAvailable = r.tpd_total - r.tpd_used;

        return (
          rpmAvailable >= 1 &&
          tpmAvailable >= minTokens &&
          rpdAvailable >= 1 &&
          tpdAvailable >= minTokens
        );
      })
      .map((r: any) => ({
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

  /**
   * Get detailed statistics for all models.
   * Useful for monitoring and debugging.
   */
  getModelStats(): Array<Model & ModelUsage> {
    const models = this.db.prepare(`
      SELECT model, origin, rank, description, enabled,
             rpm_allowed, tpm_total, rpd_total, tpd_total,
             successful_tasks, failed_tasks
      FROM models
      ORDER BY rank ASC
    `).all() as any[];

    return models.map((model) => {
      const usage = this.getModelUsage(model.model);
      return {
        name: model.model,
        origin: model.origin,
        rank: model.rank,
        description: model.description,
        enabled: model.enabled === 1,
        rpmAllowed: model.rpm_allowed,
        tpmTotal: model.tpm_total,
        rpdTotal: model.rpd_total,
        tpdTotal: model.tpd_total,
        successfulTasks: model.successful_tasks,
        failedTasks: model.failed_tasks,
        ...usage,
      };
    });
  }

  /**
   * Log a task outcome (success or failure).
   * Updates both the task_logs table and the model's aggregate counters.
   */
  logTaskOutcome(
    model: string,
    taskType: string,
    success: boolean,
    tokensUsed: number,
    errorMessage?: string
  ) {
    const now = Math.floor(Date.now() / 1000);

    // Insert into task_logs
    this.db.prepare(`
      INSERT INTO task_logs (model, task_type, success, error_message, tokens_used, timestamp)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(model, taskType, success ? 1 : 0, errorMessage || null, tokensUsed, now);

    // Update aggregate counters in models table
    if (success) {
      this.db.prepare(`
        UPDATE models
        SET successful_tasks = successful_tasks + 1,
            updated_at = ?
        WHERE model = ?
      `).run(now, model);
    } else {
      this.db.prepare(`
        UPDATE models
        SET failed_tasks = failed_tasks + 1,
            updated_at = ?
        WHERE model = ?
      `).run(now, model);
    }
  }

  /**
   * Get failure rate for a specific model over a time window.
   * Returns percentage of failed tasks (0-100).
   */
  getModelFailureRate(model: string, timeWindowSeconds = 86400): number {
    const sinceTimestamp = Math.floor(Date.now() / 1000) - timeWindowSeconds;

    const stats: any = this.db.prepare(`
      SELECT
        COUNT(*) as total_tasks,
        SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failed_tasks
      FROM task_logs
      WHERE model = ? AND timestamp >= ?
    `).get(model, sinceTimestamp);

    if (!stats || stats.total_tasks === 0) {
      return 0;
    }

    return (stats.failed_tasks / stats.total_tasks) * 100;
  }

  /**
   * Get recent failed tasks for a model.
   * Useful for understanding what types of tasks the model struggles with.
   */
  getRecentFailedTasks(model: string, limit = 10): TaskLog[] {
    return this.db.prepare(`
      SELECT id, model, task_type as taskType, success,
             error_message as errorMessage, tokens_used as tokensUsed, timestamp
      FROM task_logs
      WHERE model = ? AND success = 0
      ORDER BY timestamp DESC
      LIMIT ?
    `).all(model, limit) as TaskLog[];
  }

  /**
   * Clean up old task logs (older than specified days).
   * Default: 7 days for task logs (longer than usage logs for historical analysis).
   */
  cleanupOldTaskLogs(daysToKeep = 7): number {
    const cutoffTimestamp = Math.floor(Date.now() / 1000) - (daysToKeep * 86400);

    const result = this.db.prepare(`
      DELETE FROM task_logs WHERE timestamp < ?
    `).run(cutoffTimestamp);

    if (result.changes > 0) {
      console.log(`✓ Cleaned up ${result.changes} old task logs (>${daysToKeep} days old)`);
    }

    return result.changes;
  }
}
