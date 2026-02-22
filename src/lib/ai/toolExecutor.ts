import * as fs from "fs";
import * as path from "path";
import { Tool, ToolExecutionResult, ToolErrorResponse, ToolSuccessResponse } from "./tools/Tool";
import { toolDatabase } from "./toolDatabase";

export class ToolExecutor {
  private tools: Map<string, Tool> = new Map();
  private toolsDir: string;
  private isInitialized = false;
  private _initPromise: Promise<void> | null = null;

  constructor(toolsDir?: string) {
    this.toolsDir = toolsDir || path.join(__dirname, "tools");
  }

  /**
   * Load all tools, create their DB tables, and call init(db) on each.
   * Safe to call multiple times — returns the same Promise so concurrent
   * callers all wait for the single initialization to complete.
   */
  initialize(): Promise<void> {
    if (!this._initPromise) {
      this._initPromise = this._doInitialize();
    }
    return this._initPromise;
  }

  private async _doInitialize(): Promise<void> {
    if (this.isInitialized) return;

    if (!fs.existsSync(this.toolsDir)) {
      throw new Error(`Tools directory not found: ${this.toolsDir}`);
    }

    await this.loadToolsFromDirectory();
    await this.initToolSchemas();
    this.isInitialized = true;
  }

  private async loadToolsFromDirectory(): Promise<void> {
    const files = fs.readdirSync(this.toolsDir);

    for (const file of files) {
      if (!file.match(/\.(ts|js)$/)) continue;
      if (file === "Tool.ts" || file === "Tool.js") continue;

      const filePath = path.join(this.toolsDir, file);

      try {
        const module = await import(filePath);
        const toolDef = module.default || module;

        this.validateTool(toolDef, file);

        if (this.tools.has(toolDef.name)) {
          throw new Error(`Duplicate tool name: '${toolDef.name}'`);
        }

        this.tools.set(toolDef.name, toolDef);
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown error";
        throw new Error(`Failed to load tool from ${file}: ${msg}`);
      }
    }
  }

  /**
   * For every loaded tool:
   * 1. Run its tableSchema DDL statements against the shared ToolDatabase.
   * 2. Call tool.init(db) so the tool can store its DB reference.
   */
  private async initToolSchemas(): Promise<void> {
    for (const [, tool] of this.tools) {
      if (tool.tableSchema) {
        for (const ddl of tool.tableSchema) {
          await toolDatabase.createTable(ddl);
        }
      }
      if (typeof tool.init === "function") {
        tool.init(toolDatabase);
      }
    }
    console.log(`✓ ${this.tools.size} tools initialized with DB schemas`);
  }

  private validateTool(tool: any, sourceFile: string): void {
    if (!tool || typeof tool !== "object") throw new Error(`Tool from ${sourceFile} must be an object`);
    if (typeof tool.name !== "string" || !tool.name.trim()) throw new Error(`Tool from ${sourceFile} must have a non-empty 'name'`);
    if (typeof tool.description !== "string" || !tool.description.trim()) throw new Error(`Tool from ${sourceFile} must have a non-empty 'description'`);
    if (typeof tool.execute !== "function") throw new Error(`Tool '${tool.name}' from ${sourceFile} must export an 'execute' function`);
  }

  async executeTool(toolName: string, args: Record<string, any> = {}): Promise<ToolExecutionResult> {
    await this.initialize();
    try {
      if (!this.tools.has(toolName)) {
        return this.errorResponse(
          toolName,
          `Tool not found: '${toolName}'. Available: ${Array.from(this.tools.keys()).join(", ") || "none"}`
        );
      }

      const tool = this.tools.get(toolName)!;
      const result = await Promise.resolve(tool.execute(args));
      return this.successResponse(toolName, result);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      return this.errorResponse(toolName, msg);
    }
  }

  listTools(): Array<{ name: string; description: string }> {
    return Array.from(this.tools.values()).map((t) => ({ name: t.name, description: t.description }));
  }

  hasTool(toolName: string): boolean {
    return this.tools.has(toolName);
  }

  isReady(): boolean {
    return this.isInitialized;
  }

  private errorResponse(toolName: string, error: string): ToolErrorResponse {
    return { success: false, error, toolName, timestamp: new Date().toISOString() };
  }

  private successResponse(toolName: string, result: any): ToolSuccessResponse {
    return { success: true, result, toolName, timestamp: new Date().toISOString() };
  }
}

export default ToolExecutor;
export type { Tool, ToolExecutionResult, ToolSuccessResponse, ToolErrorResponse } from "./tools/Tool";
