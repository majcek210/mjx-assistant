import { getClient } from "./discordClient";
import { toolDatabase } from "./ai/toolDatabase";

const POLL_INTERVAL_MS = 60_000;

/**
 * Polls the reminders table every minute and delivers any due reminders
 * to the appropriate Discord channel via @mention.
 *
 * Uses the same toolDatabase that tools use, which in turn connects to
 * the same backend (SQLite file or MySQL database) as the main storage.
 */
export function startReminderScheduler(): void {
  setTimeout(() => {
    deliverDueReminders();
    setInterval(deliverDueReminders, POLL_INTERVAL_MS);
  }, 30_000);

  console.log("✓ Reminder scheduler started (polls every 60s, first check in 30s)");
}

async function deliverDueReminders(): Promise<void> {
  const client = getClient();
  if (!client) return;

  const now = Math.floor(Date.now() / 1000);

  let dueReminders: any[];
  try {
    dueReminders = await toolDatabase.query<any>(
      `SELECT id, channel_id, user_id, message FROM reminders
       WHERE remind_at <= ? AND delivered = 0
       ORDER BY remind_at ASC`,
      [now]
    );
  } catch {
    return; // Table not yet created (no reminders stored yet)
  }

  for (const reminder of dueReminders) {
    try {
      const channel = await client.channels.fetch(reminder.channel_id);
      if (!channel?.isTextBased?.()) continue;

      await channel.send(`<@${reminder.user_id}> ⏰ **Reminder:** ${reminder.message}`);

      await toolDatabase.run(
        `UPDATE reminders SET delivered = 1 WHERE id = ?`,
        [reminder.id]
      );

      console.log(`✓ Delivered reminder #${reminder.id} to channel ${reminder.channel_id}`);
    } catch (error) {
      console.error(`✗ Failed to deliver reminder #${reminder.id}:`, error);
    }
  }
}
