import * as fs from "fs";
import * as path from "path";
import { Tool, ToolExecutionResult, ToolErrorResponse, ToolSuccessResponse } from "./tools/Tool";

/**
 * ToolExecutor - Dynamically loads and manages tool execution
 *
 * Features:
 * - Automatic tool discovery from /tools folder
 * - Runtime validation of tool interface
 * - Structured error handling
 * - No global mutable state
 * - Safe concurrent execution
 */
export class ToolExecutor {
  private tools: Map<string, Tool> = new Map();
  private toolsDir: string;
  private isInitialized: boolean = false;

  constructor(toolsDir?: string) {
    // Allow custom tools directory for testing or alternative setups
    this.toolsDir = toolsDir || path.join(__dirname, "tools");
  }

  /**
   * Initialize the tool executor by loading all tools from the /tools directory
   * Must be called before using executeTool() or listTools()
   *
   * @throws Error if tools directory doesn't exist or if tool loading fails
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return; // In-memory singleton pattern - initialize only once
    }

    if (!fs.existsSync(this.toolsDir)) {
      throw new Error(`Tools directory not found: ${this.toolsDir}`);
    }

    await this.loadToolsFromDirectory();
    this.isInitialized = true;
  }

  /**
   * Load all tool modules from the tools directory
   * Validates each tool against the Tool interface
   *
   * @private
   */
  private async loadToolsFromDirectory(): Promise<void> {
    const files = fs.readdirSync(this.toolsDir);

    for (const file of files) {
      // Skip non-TypeScript/JavaScript files
      if (!file.match(/\.(ts|js)$/)) {
        continue;
      }

      // Skip the Tool interface definition itself
      if (file === "Tool.ts" || file === "Tool.js") {
        continue;
      }

      const filePath = path.join(this.toolsDir, file);

      try {
        // Dynamically import the tool module
        const module = await import(filePath);

        // Handle both default exports and named exports
        const toolDefinition = module.default || module;

        // Validate tool interface
        this.validateTool(toolDefinition, file);

        // Check for duplicate names
        if (this.tools.has(toolDefinition.name)) {
          throw new Error(
            `Duplicate tool name: '${toolDefinition.name}'. Tool names must be unique across all tool modules.`
          );
        }

        // Register the tool
        this.tools.set(toolDefinition.name, toolDefinition);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error occurred";
        throw new Error(`Failed to load tool from ${file}: ${errorMessage}`);
      }
    }
  }

  /**
   * Validate that a tool implements the required interface
   *
   * @private
   */
  private validateTool(tool: any, sourceFile: string): void {
    if (!tool || typeof tool !== "object") {
      throw new Error(`Tool from ${sourceFile} must be an object`);
    }

    if (typeof tool.name !== "string" || tool.name.trim() === "") {
      throw new Error(`Tool from ${sourceFile} must have a non-empty 'name' string property`);
    }

    if (typeof tool.description !== "string" || tool.description.trim() === "") {
      throw new Error(`Tool from ${sourceFile} must have a non-empty 'description' string property`);
    }

    if (typeof tool.execute !== "function") {
      throw new Error(
        `Tool '${tool.name}' from ${sourceFile} must export an 'execute' function`
      );
    }
  }

  /**
   * Execute a specific tool by name with provided arguments
   *
   * @param toolName - The name of the tool to execute
   * @param args - Arguments to pass to the tool
   * @returns Structured response containing result or error
   *
   * @example
   * const result = await executor.executeTool("reminder", {
   *   action: "create",
   *   reminderId: "task1",
   *   message: "Review code"
   * });
   */
  async executeTool(toolName: string, args: Record<string, any> = {}): Promise<ToolExecutionResult> {
    try {
      // Verify tool exists
      if (!this.tools.has(toolName)) {
        return this.createErrorResponse(
          toolName,
          `Tool not found: '${toolName}'. Available tools: ${Array.from(this.tools.keys()).join(", ") || "none loaded"}`
        );
      }

      const tool = this.tools.get(toolName)!;

      // Execute the tool
      const result = await Promise.resolve(tool.execute(args));

      // Return structured success response
      return this.createSuccessResponse(toolName, result);
    } catch (error) {
      // Catch any errors and return structured error response
      const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
      return this.createErrorResponse(toolName, errorMessage);
    }
  }

  /**
   * Get a list of all registered tools with their names and descriptions
   *
   * @returns Array of tool objects with name and description
   *
   * @example
   * const tools = executor.listTools();
   * console.log(tools); // [{ name: "reminder", description: "..." }, ...]
   */
  listTools(): Array<{ name: string; description: string }> {
    return Array.from(this.tools.values()).map((tool) => ({
      name: tool.name,
      description: tool.description,
    }));
  }

  /**
   * Get detailed information about all registered tools
   *
   * @returns Array of tool objects with name and description
   */
  getToolsInfo(): Array<{ name: string; description: string }> {
    return Array.from(this.tools.values()).map((tool) => ({
      name: tool.name,
      description: tool.description,
    }));
  }

  /**
   * Check if a specific tool is registered
   *
   * @param toolName - The name of the tool to check
   * @returns true if tool exists, false otherwise
   */
  hasTool(toolName: string): boolean {
    return this.tools.has(toolName);
  }

  /**
   * Get the initialized status
   *
   * @returns true if executor has been initialized
   */
  isReady(): boolean {
    return this.isInitialized;
  }

  /**
   * Create a structured error response
   *
   * @private
   */
  private createErrorResponse(toolName: string, error: string): ToolErrorResponse {
    return {
      success: false,
      error,
      toolName,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Create a structured success response
   *
   * @private
   */
  private createSuccessResponse(toolName: string, result: any): ToolSuccessResponse {
    return {
      success: true,
      result,
      toolName,
      timestamp: new Date().toISOString(),
    };
  }
}


export default ToolExecutor
export type { Tool, ToolExecutionResult, ToolSuccessResponse, ToolErrorResponse } from "./tools/Tool";
