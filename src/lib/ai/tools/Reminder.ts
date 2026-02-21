import { Tool } from "./Tool";

/**
 * Reminder tool - demonstrates the tool interface
 * Stores reminders for later reference
 */
const reminders: Map<string, { message: string; createdAt: Date }> = new Map();

const ReminderTool: Tool = {
  name: "reminder",
  description: "Create, retrieve, or list reminders. If a argument is missing, make up one. Usage: { action: 'create'|'get'|'list', reminderId: string, message?: string }",

  execute: async (args: Record<string, any>) => {
    const { action, reminderId, message } = args;

    if (!action) {
      throw new Error("Missing required argument: action (must be 'create', 'get', or 'list')");
    }

    switch (action.toLowerCase()) {
      case "create": {
        if (!reminderId) {
          throw new Error("Missing required argument: reminderId");
        }
        if (!message) {
          throw new Error("Missing required argument: message");
        }
        if (reminders.has(reminderId)) {
          throw new Error(`Reminder with ID '${reminderId}' already exists`);
        }

        reminders.set(reminderId, {
          message,
          createdAt: new Date(),
        });

        return {
          status: "created",
          reminderId,
          message,
          createdAt: reminders.get(reminderId)!.createdAt.toISOString(),
        };
      }

      case "get": {
        if (!reminderId) {
          throw new Error("Missing required argument: reminderId");
        }
        if (!reminders.has(reminderId)) {
          throw new Error(`Reminder with ID '${reminderId}' not found`);
        }

        const reminder = reminders.get(reminderId)!;
        return {
          status: "found",
          reminderId,
          message: reminder.message,
          createdAt: reminder.createdAt.toISOString(),
        };
      }

      case "list": {
        const allReminders = Array.from(reminders.entries()).map(([id, data]) => ({
          reminderId: id,
          message: data.message,
          createdAt: data.createdAt.toISOString(),
        }));

        return {
          status: "success",
          count: allReminders.length,
          reminders: allReminders,
        };
      }

      default:
        throw new Error(`Unknown action: '${action}'. Must be 'create', 'get', or 'list'`);
    }
  },
};

export default ReminderTool;
