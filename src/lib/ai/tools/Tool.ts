import { ToolDatabase } from "../toolDatabase";

/**
 * Standard interface that all tools must implement.
 * Tools are dynamically loaded from the /tools folder.
 */
export interface Tool {
  /** Unique name used to call this tool. */
  name: string;

  /** Description sent to the AI so it knows when/how to use this tool. */
  description: string;

  /**
   * Optional DDL statements that create this tool's tables.
   * ToolExecutor runs these against the shared ToolDatabase during initialization.
   * Use CREATE TABLE IF NOT EXISTS — statements must be idempotent.
   *
   * @example
   * tableSchema = [
   *   `CREATE TABLE IF NOT EXISTS my_tool_data (
   *      id INTEGER PRIMARY KEY AUTOINCREMENT,
   *      value TEXT NOT NULL
   *    )`
   * ]
   */
  tableSchema?: string[];

  /**
   * Optional lifecycle hook called once after all table schemas are created.
   * The tool should store the `db` reference for use in `execute()`.
   */
  init?(db: ToolDatabase): void;

  /**
   * Execute the tool with the provided arguments.
   * Discord context (channelId, userId) is automatically injected by the handler.
   */
  execute(args: Record<string, any>): Promise<any> | any;
}

export interface ToolErrorResponse {
  success: false;
  error: string;
  toolName: string;
  timestamp: string;
}

export interface ToolSuccessResponse {
  success: true;
  result: any;
  toolName: string;
  timestamp: string;
}

export type ToolExecutionResult = ToolSuccessResponse | ToolErrorResponse;
