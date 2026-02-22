import client from "./lib/bot/main";
import { config } from "dotenv";
import { startReminderScheduler } from "./lib/reminderScheduler";

config();

async function main() {
  startReminderScheduler();
  client.start(process.env.BOT_TOKEN);
}

main();
