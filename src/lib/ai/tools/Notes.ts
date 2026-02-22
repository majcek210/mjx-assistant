import { Tool } from "./Tool";
import { ToolDatabase } from "../toolDatabase";

/**
 * Notes tool — persistent, per-user notes stored in the main project DB.
 * userId is auto-injected by the messageCreate handler.
 *
 * Actions: create, list, get, update, delete
 */
const NotesTool: Tool = {
  name: "notes",
  description:
    'Create, list, retrieve, update, or delete persistent notes stored in the database. ' +
    'Arguments: { action: "create"|"list"|"get"|"update"|"delete", title?: string, content?: string, id?: number }. ' +
    'userId is injected automatically.',

  tableSchema: [
    `CREATE TABLE IF NOT EXISTS notes (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    TEXT    NOT NULL,
      title      TEXT    NOT NULL,
      content    TEXT    NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    )`,
    `CREATE INDEX IF NOT EXISTS idx_notes_user ON notes(user_id)`,
  ],

  init(db: ToolDatabase) {
    (this as any)._db = db;
  },

  async execute(args: Record<string, any>) {
    const db: ToolDatabase = (this as any)._db;
    const { action, title, content, id, userId } = args;

    if (!action) return { error: 'Missing argument: action ("create", "list", "get", "update", or "delete")' };
    if (!userId) return { error: "Missing userId (auto-injected by handler)" };

    switch (String(action).toLowerCase()) {
      case "create": {
        if (!title) return { error: "Missing argument: title" };
        if (!content) return { error: "Missing argument: content" };
        const now = Math.floor(Date.now() / 1000);
        const result = await db.run(
          `INSERT INTO notes (user_id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
          [userId, title, content, now, now]
        );
        return { success: true, id: Number(result.lastInsertRowid), title, content };
      }

      case "list": {
        const rows = await db.query<any>(
          `SELECT id, title, created_at, updated_at FROM notes WHERE user_id = ? ORDER BY updated_at DESC`,
          [userId]
        );
        return {
          count: rows.length,
          notes: rows.map((r) => ({
            id: r.id,
            title: r.title,
            createdAt: new Date(r.created_at * 1000).toISOString(),
            updatedAt: new Date(r.updated_at * 1000).toISOString(),
          })),
        };
      }

      case "get": {
        if (!id) return { error: "Missing argument: id" };
        const row = await db.get<any>(
          `SELECT id, title, content, created_at, updated_at FROM notes WHERE id = ? AND user_id = ?`,
          [Number(id), userId]
        );
        if (!row) return { error: `Note ${id} not found` };
        return {
          id: row.id, title: row.title, content: row.content,
          createdAt: new Date(row.created_at * 1000).toISOString(),
          updatedAt: new Date(row.updated_at * 1000).toISOString(),
        };
      }

      case "update": {
        if (!id) return { error: "Missing argument: id" };
        if (!content && !title) return { error: "Provide at least one of: title, content" };
        const existing = await db.get<any>(
          `SELECT title, content FROM notes WHERE id = ? AND user_id = ?`,
          [Number(id), userId]
        );
        if (!existing) return { error: `Note ${id} not found` };
        const newTitle = title ?? existing.title;
        const newContent = content ?? existing.content;
        const now = Math.floor(Date.now() / 1000);
        await db.run(
          `UPDATE notes SET title = ?, content = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
          [newTitle, newContent, now, Number(id), userId]
        );
        return { success: true, id: Number(id), title: newTitle, content: newContent };
      }

      case "delete": {
        if (!id) return { error: "Missing argument: id" };
        const result = await db.run(
          `DELETE FROM notes WHERE id = ? AND user_id = ?`,
          [Number(id), userId]
        );
        return { success: result.changes > 0, deleted: result.changes };
      }

      default:
        return { error: `Unknown action: "${action}". Use create, list, get, update, or delete.` };
    }
  },
};

export default NotesTool;
