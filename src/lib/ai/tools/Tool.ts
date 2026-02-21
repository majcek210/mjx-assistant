/**
 * Standard interface that all tools must implement
 * Tools are dynamically loaded from the /tools folder
 */
export interface Tool {
  /** Unique identifier for the tool */
  name: string;

  /** Description of what the tool does */
  description: string;

  /**
   * Execute the tool with the provided arguments
   * @param args - Arguments passed to the tool
   * @returns The result of tool execution
   * @throws Errors are caught and returned in structured format
   */
  execute(args: Record<string, any>): Promise<any> | any;
}

/**
 * Standard error response format for tool execution failures
 */
export interface ToolErrorResponse {
  success: false;
  error: string;
  toolName: string;
  timestamp: string;
}

/**
 * Standard success response format for tool execution
 */
export interface ToolSuccessResponse {
  success: true;
  result: any;
  toolName: string;
  timestamp: string;
}

/** Tool execution result (success or error) */
export type ToolExecutionResult = ToolSuccessResponse | ToolErrorResponse;
