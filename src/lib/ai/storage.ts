import Database from "better-sqlite3";

export type ModelUsage = {
  model: string;
  rpmUsed: number;
  tpmUsed: number;
  rpdUsed: number;
  timestamp: number; // last reset timestamp for usage tracking
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
};

export class ModelStore {
  private db: Database.Database;

  constructor(path = "./db.sqlite") {
    this.db = new Database(path);
    this.db.pragma("foreign_keys = ON");
    this.db.exec(`DROP TABLE IF EXISTS model_usage;`);
this.db.exec(`DROP TABLE IF EXISTS models;`);
    this.createTables();
  }

  private createTables() {
  // Create models table first
  this.db.prepare(`
    CREATE TABLE IF NOT EXISTS models (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      model TEXT NOT NULL UNIQUE,
      origin TEXT NOT NULL,
      rank INTEGER NOT NULL DEFAULT 0,
      description TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      rpm_used INTEGER NOT NULL DEFAULT 0,
      rpm_allowed INTEGER NOT NULL DEFAULT 0,
      tpm_used INTEGER NOT NULL DEFAULT 0,
      tpm_total INTEGER NOT NULL DEFAULT 0,
      rpd_used INTEGER NOT NULL DEFAULT 0,
      rpd_total INTEGER NOT NULL DEFAULT 0,
      last_minute INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      last_day INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      timestamp INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
  `).run();

  // Then create model_usage table
  this.db.prepare(`
    CREATE TABLE IF NOT EXISTS model_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      model TEXT NOT NULL,
      rpm_used INTEGER NOT NULL,
      tpm_used INTEGER NOT NULL,
      rpd_used INTEGER NOT NULL,
      last_minute INTEGER NOT NULL,
      last_day INTEGER NOT NULL,
      FOREIGN KEY(model) REFERENCES models(model)
    );
  `).run();

  console.log("Created tables");
}


  seedModels(models: Model[]) {
    const stmt = this.db.prepare(`
      INSERT INTO models (model, origin, rank, description, enabled, rpm_allowed, tpm_total, rpd_total)
      VALUES (@name, @origin, @rank, @description, @enabled, @rpmAllowed, @tpmTotal, @rpdTotal)
      ON CONFLICT(model) DO UPDATE SET
        origin = excluded.origin,
        rank = excluded.rank,
        description = excluded.description,
        enabled = excluded.enabled,
        rpm_allowed = excluded.rpm_allowed,
        tpm_total = excluded.tpm_total,
        rpd_total = excluded.rpd_total
    `);

    const tx = this.db.transaction((rows: Model[]) => {
  for (const row of rows) {
    stmt.run({
      name: row.name,
      origin: row.origin,
      rank: row.rank,
      description: row.description,
      enabled: row.enabled ? 1 : 0,
      rpm_used: 0,
      rpm_allowed: row.rpmAllowed,
      tpm_used: 0,
      tpm_total: row.tpmTotal,
      rpd_used: 0,
      rpd_total: row.rpdTotal,
      last_minute: Math.floor(Date.now() / 1000),
      last_day: Math.floor(Date.now() / 1000),
      timestamp: Math.floor(Date.now() / 1000),
    });
  }
});


    tx(models);
  }

  enableModel(name: string) {
    this.db.prepare(`UPDATE models SET enabled = 1 WHERE model = ?`).run(name);
  }

  disableModel(name: string) {
    this.db.prepare(`UPDATE models SET enabled = 0 WHERE model = ?`).run(name);
  }

  logModelUsage(model: string, rpmInc = 1, tpmInc = 0, rpdInc = 1) {
    const usage : any = this.db.prepare(`SELECT * FROM model_usage WHERE model = ?`).get(model);

    const now = Math.floor(Date.now() / 1000);

    if (!usage) {
      this.db.prepare(`
        INSERT INTO model_usage (model, rpm_used, tpm_used, rpd_used, last_minute, last_day)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(model, rpmInc, tpmInc, rpdInc, now, now);
      return;
    }

    // Reset counters if time has passed
    let rpmUsed = usage.rpm_used;
    let tpmUsed = usage.tpm_used;
    let rpdUsed = usage.rpd_used;
    const lastMinute = usage.last_minute;
    const lastDay = usage.last_day;

    if (now - lastMinute >= 60) rpmUsed = 0;
    if (now - lastDay >= 86400) rpdUsed = 0;

    this.db.prepare(`
      UPDATE model_usage SET
        rpm_used = ?,
        tpm_used = ?,
        rpd_used = ?,
        last_minute = ?,
        last_day = ?
      WHERE model = ?
    `).run(rpmUsed + rpmInc, tpmUsed + tpmInc, rpdUsed + rpdInc, now, now, model);
  }

  getModelUsage(model: string) {
    return this.db.prepare(`SELECT * FROM model_usage WHERE model = ?`).get(model);
  }

  getAllAvailableModels(minTokens = 400): Model[] {
    const rows = this.db.prepare(`
      SELECT m.model as name, m.origin, m.rank, m.description, m.enabled,
             m.rpm_allowed, u.rpm_used,
             m.tpm_total, u.tpm_used,
             m.rpd_total, u.rpd_used
      FROM models m
      LEFT JOIN model_usage u ON u.model = m.model
      WHERE m.enabled = 1
        AND (m.rpm_allowed - IFNULL(u.rpm_used, 0)) >= 1
        AND (m.tpm_total - IFNULL(u.tpm_used, 0)) >= ?
    `).all(minTokens);

    return rows.map((r: any) => ({
      name: r.name,
      origin: r.origin,
      rank: r.rank,
      description: r.description,
      enabled: r.enabled === 1,
      rpmAllowed: r.rpm_allowed,
      tpmTotal: r.tpm_total,
      rpdTotal: r.rpd_total
    }));
  }
}
