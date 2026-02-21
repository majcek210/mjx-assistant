import { Tool } from "./Tool";

/**
 * Logger tool - demonstrates a simple stateless tool
 * Logs messages with timestamps and severity levels
 */
const LoggerTool: Tool = {
  name: "logger",
  description: "Log messages with different severity levels. Usage: { level: 'info'|'warn'|'error', message: string }",

  execute: async (args: Record<string, any>) => {
    const { level = "info", message } = args;

    if (!message || typeof message !== "string") {
      throw new Error("Missing or invalid required argument: message (must be a string)");
    }

    const validLevels = ["info", "warn", "error"];
    if (!validLevels.includes(level)) {
      throw new Error(
        `Invalid log level: '${level}'. Must be one of: ${validLevels.join(", ")}`
      );
    }

    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] [${level.toUpperCase()}] ${message}`;

    // In a real system, this would persist to file/service
    console.log(logEntry);

    return {
      status: "logged",
      level,
      message,
      timestamp,
      logEntry,
    };
  },
};

export default LoggerTool;
