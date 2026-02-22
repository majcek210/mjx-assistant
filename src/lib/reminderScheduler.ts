import { getClient } from "./discordClient";
import { toolDatabase } from "./ai/toolDatabase";

const POLL_INTERVAL_MS = 60_000; // check every minute

/**
 * Polls the reminders table every minute and delivers any due reminders
 * to the appropriate Discord channel via @mention.
 *
 * Must be called after the Discord client is available (i.e. after client.start()).
 * The first delivery attempt happens 30 seconds after calling start() to give
 * the client time to connect.
 */
export function startReminderScheduler(): void {
  // Delay the first tick slightly to let the Discord client finish connecting
  setTimeout(() => {
    deliverDueReminders();
    setInterval(deliverDueReminders, POLL_INTERVAL_MS);
  }, 30_000);

  console.log("✓ Reminder scheduler started (polls every 60s, first check in 30s)");
}

async function deliverDueReminders(): Promise<void> {
  const client = getClient();
  if (!client) return; // Discord not connected yet

  const now = Math.floor(Date.now() / 1000);

  let dueReminders: any[];
  try {
    dueReminders = toolDatabase.query<any>(
      `SELECT id, channel_id, user_id, message FROM reminders
       WHERE remind_at <= ? AND delivered = 0
       ORDER BY remind_at ASC`,
      [now]
    );
  } catch {
    // Table may not exist yet (no reminders created); ignore silently
    return;
  }

  for (const reminder of dueReminders) {
    try {
      const channel = await client.channels.fetch(reminder.channel_id);
      if (!channel?.isTextBased?.()) continue;

      await channel.send(`<@${reminder.user_id}> ⏰ **Reminder:** ${reminder.message}`);

      toolDatabase.run(
        `UPDATE reminders SET delivered = 1 WHERE id = ?`,
        [reminder.id]
      );

      console.log(`✓ Delivered reminder #${reminder.id} to channel ${reminder.channel_id}`);
    } catch (error) {
      console.error(`✗ Failed to deliver reminder #${reminder.id}:`, error);
      // Leave delivered = 0 so it retries next tick
    }
  }
}
