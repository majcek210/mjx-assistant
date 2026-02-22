import { Tool } from "./Tool";
import { ToolDatabase } from "../toolDatabase";

/**
 * Reminder tool — DB-backed, with real scheduled delivery.
 *
 * Reminders are stored in tools.db and delivered by ReminderScheduler
 * (src/lib/reminderScheduler.ts) which polls every minute.
 *
 * channelId and userId are automatically injected by the messageCreate handler —
 * the AI does NOT need to provide them.
 *
 * Actions:
 *   create  — schedule a reminder
 *   list    — show pending reminders for this user
 *   delete  — cancel a reminder by id
 *
 * Time formats accepted (create):
 *   Relative: 30s, 10m, 2h, 1d
 *   Absolute: any string parseable by new Date() (ISO 8601, "tomorrow at 9am", etc.)
 */
const ReminderTool: Tool = {
  name: "reminder",
  description:
    'Create, list, or delete scheduled reminders stored in the database. ' +
    'Arguments: { action: "create"|"list"|"delete", message?: string, time?: string (e.g. "30m", "2h", "2026-03-01T09:00:00"), id?: number }. ' +
    'channelId and userId are injected automatically — do NOT include them.',

  tableSchema: [
    `CREATE TABLE IF NOT EXISTS reminders (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      channel_id  TEXT    NOT NULL,
      user_id     TEXT    NOT NULL,
      message     TEXT    NOT NULL,
      remind_at   INTEGER NOT NULL,
      created_at  INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      delivered   INTEGER NOT NULL DEFAULT 0
    )`,
    `CREATE INDEX IF NOT EXISTS idx_reminders_remind_at ON reminders(remind_at, delivered)`,
  ],

  init(db: ToolDatabase) {
    (this as any)._db = db;
  },

  execute(args: Record<string, any>) {
    const db: ToolDatabase = (this as any)._db;
    const { action, message, time, channelId, userId, id } = args;

    if (!action) return { error: 'Missing required argument: action ("create", "list", or "delete")' };

    switch (String(action).toLowerCase()) {
      case "create": {
        if (!message) return { error: "Missing argument: message" };
        if (!time) return { error: "Missing argument: time (e.g. '30m', '2h', '2026-03-01T09:00')" };
        if (!channelId || !userId) return { error: "Missing channelId or userId (injected automatically)" };

        const remindAt = parseTime(time);
        if (!remindAt) return { error: `Cannot parse time "${time}". Use: 30s, 10m, 2h, 1d, or ISO 8601.` };

        const result = db.run(
          `INSERT INTO reminders (channel_id, user_id, message, remind_at) VALUES (?, ?, ?, ?)`,
          [channelId, userId, message, remindAt]
        );

        return {
          success: true,
          id: Number(result.lastInsertRowid),
          message,
          remindAt: new Date(remindAt * 1000).toISOString(),
          inSeconds: remindAt - Math.floor(Date.now() / 1000),
        };
      }

      case "list": {
        if (!userId) return { error: "Missing userId" };

        const rows = db.query<any>(
          `SELECT id, message, remind_at FROM reminders
           WHERE user_id = ? AND delivered = 0
           ORDER BY remind_at ASC`,
          [userId]
        );

        return {
          count: rows.length,
          reminders: rows.map((r) => ({
            id: r.id,
            message: r.message,
            remindAt: new Date(r.remind_at * 1000).toISOString(),
          })),
        };
      }

      case "delete": {
        if (!id) return { error: "Missing argument: id" };
        if (!userId) return { error: "Missing userId" };

        const result = db.run(
          `DELETE FROM reminders WHERE id = ? AND user_id = ?`,
          [Number(id), userId]
        );

        return { success: result.changes > 0, deleted: result.changes };
      }

      default:
        return { error: `Unknown action: "${action}". Use create, list, or delete.` };
    }
  },
};

function parseTime(input: string): number | null {
  // Relative: 30s, 10m, 2h, 1d (case-insensitive)
  const rel = input.trim().match(/^(\d+)(s|m|h|d)$/i);
  if (rel) {
    const n = parseInt(rel[1], 10);
    const unit = rel[2].toLowerCase();
    const mult: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
    return Math.floor(Date.now() / 1000) + n * mult[unit];
  }

  // Absolute date string
  const d = new Date(input);
  if (!isNaN(d.getTime())) return Math.floor(d.getTime() / 1000);

  return null;
}

export default ReminderTool;
