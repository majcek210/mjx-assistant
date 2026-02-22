/**
 * Per-channel in-memory conversation history.
 *
 * Provides session-level context so the bot remembers recent exchanges
 * even when the user sends a fresh @mention (no Discord reply chain).
 *
 * Limits:
 * - MAX_ENTRIES: last N turns kept per channel
 * - TTL_MS: session expires after this many ms of inactivity
 */

const MAX_ENTRIES = 10;
const TTL_MS = 60 * 60 * 1000; // 1 hour

interface SessionEntry {
  role: "user" | "bot";
  content: string;
  timestamp: number;
}

interface Session {
  entries: SessionEntry[];
  lastActive: number;
}

class SessionMemory {
  private sessions = new Map<string, Session>();

  /** Add a turn to the channel's history. */
  add(channelId: string, role: "user" | "bot", content: string): void {
    const now = Date.now();
    const trimmed = content.slice(0, 500);

    if (!this.sessions.has(channelId)) {
      this.sessions.set(channelId, { entries: [], lastActive: now });
    }

    const session = this.sessions.get(channelId)!;
    session.entries.push({ role, content: trimmed, timestamp: now });
    session.lastActive = now;

    // Keep only the last MAX_ENTRIES
    if (session.entries.length > MAX_ENTRIES) {
      session.entries.splice(0, session.entries.length - MAX_ENTRIES);
    }
  }

  /**
   * Return the channel's history as a formatted context string,
   * or an empty string if no valid session exists.
   */
  format(channelId: string): string {
    const session = this.sessions.get(channelId);
    if (!session || session.entries.length === 0) return "";

    // Expire stale sessions
    if (Date.now() - session.lastActive > TTL_MS) {
      this.sessions.delete(channelId);
      return "";
    }

    const lines = session.entries
      .map((e) => `[${e.role === "bot" ? "Assistant" : "User"}]: ${e.content}`)
      .join("\n");

    return `Previous conversation:\n${lines}\n\n`;
  }

  /** Clear a channel's history (e.g., on /reset command). */
  clear(channelId: string): void {
    this.sessions.delete(channelId);
  }

  /** Periodic cleanup of expired sessions (call occasionally). */
  cleanup(): void {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (now - session.lastActive > TTL_MS) {
        this.sessions.delete(id);
      }
    }
  }
}

// Singleton exported for use across the application
export const sessionMemory = new SessionMemory();
