import { IStorage, Model, ModelUsage, TaskLog } from "./IStorage";

export type MySQLConfig = {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
};

/**
 * MySQL / MariaDB storage adapter.
 * Requires: npm install mysql2
 * Works with both MySQL 8+ and MariaDB 10.5+.
 */
export class MySQLStorage implements IStorage {
  private pool: any; // mysql2 Pool

  constructor(config: MySQLConfig) {
    // Dynamic import to make mysql2 an optional dependency
    try {
      const mysql = require("mysql2/promise");
      this.pool = mysql.createPool({
        host: config.host,
        port: config.port,
        user: config.user,
        password: config.password,
        database: config.database,
        waitForConnections: true,
        connectionLimit: 10,
        charset: "utf8mb4",
      });
    } catch {
      throw new Error(
        "mysql2 is not installed. Run: npm install mysql2"
      );
    }
  }

  private async query(sql: string, params: any[] = []): Promise<any[]> {
    const [rows] = await this.pool.execute(sql, params);
    return rows as any[];
  }

  private async execute(sql: string, params: any[] = []): Promise<{ affectedRows: number }> {
    const [result] = await this.pool.execute(sql, params);
    return result as any;
  }

  async seedModels(models: Model[]): Promise<void> {
    await this.createTables();

    for (const row of models) {
      if (
        row.rpmAllowed === undefined ||
        row.tpmTotal === undefined ||
        row.rpdTotal === undefined
      ) {
        console.error("⚠ Missing limits in row, skipping:", row);
        continue;
      }

      const tpdTotal = row.tpdTotal ?? row.tpmTotal * 1440;
      const updatedAt = Math.floor(Date.now() / 1000);

      await this.execute(
        `INSERT INTO models
          (model, origin, \`rank\`, description, enabled, rpm_allowed, tpm_total, rpd_total, tpd_total, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
          origin = VALUES(origin), \`rank\` = VALUES(\`rank\`),
          description = VALUES(description), enabled = VALUES(enabled),
          rpm_allowed = VALUES(rpm_allowed), tpm_total = VALUES(tpm_total),
          rpd_total = VALUES(rpd_total), tpd_total = VALUES(tpd_total),
          updated_at = VALUES(updated_at)`,
        [
          row.name, row.origin, row.rank, row.description,
          row.enabled ? 1 : 0, row.rpmAllowed, row.tpmTotal,
          row.rpdTotal, tpdTotal, updatedAt,
        ]
      );
    }

    console.log(`✓ Seeded ${models.length} models (MySQL)`);
  }

  async createTables(): Promise<void> {
    await this.execute(`
      CREATE TABLE IF NOT EXISTS models (
        id INT AUTO_INCREMENT PRIMARY KEY,
        model VARCHAR(255) NOT NULL UNIQUE,
        origin VARCHAR(100) NOT NULL,
        \`rank\` INT NOT NULL DEFAULT 0,
        description TEXT,
        enabled TINYINT NOT NULL DEFAULT 1,
        rpm_allowed INT NOT NULL DEFAULT 0,
        tpm_total INT NOT NULL DEFAULT 0,
        rpd_total INT NOT NULL DEFAULT 0,
        tpd_total INT NOT NULL DEFAULT 0,
        successful_tasks INT NOT NULL DEFAULT 0,
        failed_tasks INT NOT NULL DEFAULT 0,
        created_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
        updated_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP())
      )
    `);

    await this.execute(`
      CREATE TABLE IF NOT EXISTS usage_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        model VARCHAR(255) NOT NULL,
        requests INT NOT NULL DEFAULT 1,
        tokens INT NOT NULL DEFAULT 0,
        timestamp INT NOT NULL,
        INDEX idx_usage_timestamp (timestamp),
        INDEX idx_usage_model_ts (model, timestamp)
      )
    `);

    await this.execute(`
      CREATE TABLE IF NOT EXISTS task_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        model VARCHAR(255) NOT NULL,
        task_type VARCHAR(100) NOT NULL,
        success TINYINT NOT NULL,
        error_message TEXT,
        tokens_used INT NOT NULL DEFAULT 0,
        timestamp INT NOT NULL,
        INDEX idx_task_model_success (model, success),
        INDEX idx_task_timestamp (timestamp)
      )
    `);
  }

  async enableModel(name: string): Promise<void> {
    await this.execute(
      `UPDATE models SET enabled = 1, updated_at = ? WHERE model = ?`,
      [Math.floor(Date.now() / 1000), name]
    );
  }

  async disableModel(name: string): Promise<void> {
    await this.execute(
      `UPDATE models SET enabled = 0, updated_at = ? WHERE model = ?`,
      [Math.floor(Date.now() / 1000), name]
    );
  }

  async logModelUsage(model: string, requests = 1, tokens = 0): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    await this.execute(
      `INSERT INTO usage_logs (model, requests, tokens, timestamp) VALUES (?, ?, ?, ?)`,
      [model, requests, tokens, now]
    );
  }

  async getModelUsage(model: string): Promise<ModelUsage> {
    const now = Math.floor(Date.now() / 1000);

    const [minRow] = await this.query(
      `SELECT COALESCE(SUM(requests),0) as rpm_used, COALESCE(SUM(tokens),0) as tpm_used
       FROM usage_logs WHERE model = ? AND timestamp >= ?`,
      [model, now - 60]
    );

    const [dayRow] = await this.query(
      `SELECT COALESCE(SUM(requests),0) as rpd_used, COALESCE(SUM(tokens),0) as tpd_used
       FROM usage_logs WHERE model = ? AND timestamp >= ?`,
      [model, now - 86400]
    );

    return {
      model,
      rpmUsed: Number(minRow?.rpm_used ?? 0),
      tpmUsed: Number(minRow?.tpm_used ?? 0),
      rpdUsed: Number(dayRow?.rpd_used ?? 0),
      tpdUsed: Number(dayRow?.tpd_used ?? 0),
    };
  }

  async cleanupOldLogs(): Promise<number> {
    const cutoff = Math.floor(Date.now() / 1000) - 86400;
    const result = await this.execute(
      `DELETE FROM usage_logs WHERE timestamp < ?`,
      [cutoff]
    );
    return result.affectedRows;
  }

  async getAllAvailableModels(minTokens = 400): Promise<Model[]> {
    const now = Math.floor(Date.now() / 1000);
    const oneMinuteAgo = now - 60;
    const oneDayAgo = now - 86400;

    const rows = await this.query(
      `SELECT
        m.model as name, m.origin, m.\`rank\`, m.description, m.enabled,
        m.rpm_allowed, m.tpm_total, m.rpd_total, m.tpd_total,
        COALESCE((SELECT SUM(requests) FROM usage_logs WHERE model = m.model AND timestamp >= ?), 0) as rpm_used,
        COALESCE((SELECT SUM(tokens)   FROM usage_logs WHERE model = m.model AND timestamp >= ?), 0) as tpm_used,
        COALESCE((SELECT SUM(requests) FROM usage_logs WHERE model = m.model AND timestamp >= ?), 0) as rpd_used,
        COALESCE((SELECT SUM(tokens)   FROM usage_logs WHERE model = m.model AND timestamp >= ?), 0) as tpd_used
       FROM models m WHERE m.enabled = 1 ORDER BY m.\`rank\` ASC`,
      [oneMinuteAgo, oneMinuteAgo, oneDayAgo, oneDayAgo]
    );

    return rows
      .filter((r) => {
        return (
          r.rpm_allowed - Number(r.rpm_used) >= 1 &&
          r.tpm_total   - Number(r.tpm_used) >= minTokens &&
          r.rpd_total   - Number(r.rpd_used) >= 1 &&
          r.tpd_total   - Number(r.tpd_used) >= minTokens
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
    const models = await this.query(
      `SELECT model, origin, \`rank\`, description, enabled,
              rpm_allowed, tpm_total, rpd_total, tpd_total,
              successful_tasks, failed_tasks
       FROM models ORDER BY \`rank\` ASC`
    );

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

    await this.execute(
      `INSERT INTO task_logs (model, task_type, success, error_message, tokens_used, timestamp)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [model, taskType, success ? 1 : 0, errorMessage || null, tokensUsed, now]
    );

    const col = success ? "successful_tasks" : "failed_tasks";
    await this.execute(
      `UPDATE models SET ${col} = ${col} + 1, updated_at = ? WHERE model = ?`,
      [now, model]
    );
  }

  async getModelFailureRate(
    model: string,
    timeWindowSeconds = 86400
  ): Promise<number> {
    const since = Math.floor(Date.now() / 1000) - timeWindowSeconds;

    const [row] = await this.query(
      `SELECT COUNT(*) as total_tasks,
              SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failed_tasks
       FROM task_logs WHERE model = ? AND timestamp >= ?`,
      [model, since]
    );

    if (!row || Number(row.total_tasks) === 0) return 0;
    return (Number(row.failed_tasks) / Number(row.total_tasks)) * 100;
  }

  async getRecentFailedTasks(model: string, limit = 10): Promise<TaskLog[]> {
    const rows = await this.query(
      `SELECT id, model, task_type as taskType, success,
              error_message as errorMessage, tokens_used as tokensUsed, timestamp
       FROM task_logs WHERE model = ? AND success = 0
       ORDER BY timestamp DESC LIMIT ?`,
      [model, limit]
    );
    return rows as TaskLog[];
  }

  async cleanupOldTaskLogs(daysToKeep = 7): Promise<number> {
    const cutoff = Math.floor(Date.now() / 1000) - daysToKeep * 86400;
    const result = await this.execute(
      `DELETE FROM task_logs WHERE timestamp < ?`,
      [cutoff]
    );
    return result.affectedRows;
  }
}
