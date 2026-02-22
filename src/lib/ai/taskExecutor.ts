import { IStorage } from "./storage/IStorage";
import { MainAgent, TaskAnalysis } from "./mainAgent";
import { AdapterFactory } from "./adapters/AdapterFactory";
import * as fs from "fs";
import * as path from "path";
import ToolExecutor from "../../configs/toolExecutor";

export type ModelLimits = {
  rpm: { used: number; limit: number };
  tpm: { used: number; limit: number };
  rpd: { used: number; limit: number };
  tpd: { used: number; limit: number };
};

export type TaskResult = {
  success: boolean;
  response?: string;
  error?: string;
  modelUsed: string;
  tokensUsed: number;
  analysis: TaskAnalysis;
  limits?: ModelLimits;
};

export class TaskExecutor {
  private storage: IStorage;
  private mainAgent: MainAgent;
  private agentPrompt: string;
  private cachedToolsStr: string | null = null;

  constructor(storage: IStorage) {
    this.storage = storage;
    this.mainAgent = new MainAgent(storage);

    // Load agent prompt from root config.json
    try {
      const configPath = path.join(process.cwd(), "config.json");
      const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      this.agentPrompt = config.mainAgent?.agentPrompt || "";
      if (this.agentPrompt) {
        console.log("✓ Agent instructions loaded from config.json");
      }
    } catch {
      console.warn("⚠ Could not load agent instructions from config.json");
      this.agentPrompt = "";
    }

    const availableOrigins = AdapterFactory.getAvailableOrigins();
    if (availableOrigins.length === 0) {
      throw new Error(
        "No AI providers configured. Set at least one API key in .env (GEMINI_API_KEY or GROQ_API_KEY)"
      );
    }

    console.log(`✓ Available AI providers: ${availableOrigins.join(", ")}`);
  }

  /**
   * Execute a task using intelligent model selection.
   * Context is the formatted conversation history — injected into the worker prompt only,
   * NOT sent to the main agent (saves tokens on the selector call).
   */
  async executeTask(
    userTask: string,
    taskType: string = "general",
    context?: string,
  ): Promise<TaskResult> {
    console.log(`\n=== Executing Task ===`);
    console.log(`Task: "${userTask.slice(0, 120)}"`);
    console.log(`Type: ${taskType}\n`);

    try {
      // Step 1: Main agent selects model (gets only the raw task, no context — saves tokens)
      console.log("Step 1: Consulting main agent for model selection...");
      const analysis = await this.mainAgent.selectModelForTask(userTask);

      // Step 2: Build worker prompt (context + agent instructions + tools + task)
      const formattedTools = await this.getFormattedTools();
      const contextPrefix = context || "";
      const taskWithInstructions = this.agentPrompt
        ? `${this.agentPrompt}\n\nAvailable Tools:\n${formattedTools}\n\n${contextPrefix}User Task: ${userTask}`
        : `Available Tools:\n${formattedTools}\n\n${contextPrefix}User Task: ${userTask}`;

      // Step 3: Execute with selected model
      console.log(`Step 2: Executing task with ${analysis.selectedModel}...`);
      return await this.executeWithModel(
        analysis.selectedModel,
        taskWithInstructions,
        taskType,
        analysis,
      );
    } catch (error: any) {
      console.error("✗ Task execution failed:", error.message);
      return {
        success: false,
        error: error.message,
        modelUsed: "none",
        tokensUsed: 0,
        analysis: {
          selectedModel: "none",
          reasoning: "Failed to select model",
          estimatedTokens: 0,
          taskComplexity: "simple",
        },
      };
    }
  }

  /** Cache tool list string — tools don't change at runtime. */
  private async getFormattedTools(): Promise<string> {
    if (this.cachedToolsStr === null) {
      const tools = await ToolExecutor.listTools();
      this.cachedToolsStr = tools
        .map((t) => `- ${t.name}: ${t.description}`)
        .join("\n");
    }
    return this.cachedToolsStr;
  }

  private async executeWithModel(
    modelName: string,
    userTask: string,
    taskType: string,
    analysis: TaskAnalysis,
  ): Promise<TaskResult> {
    const allModels = await this.storage.getModelStats();
    const modelInfo = allModels.find((m) => m.name === modelName);

    if (!modelInfo) {
      throw new Error(`Model not found in database: ${modelName}`);
    }

    try {
      const adapter = AdapterFactory.getAdapter(modelInfo.origin);
      const t0 = Date.now();
      const result = await adapter.generateContent({ model: modelName, prompt: userTask });
      const elapsed = Date.now() - t0;

      const text = result.text || "";
      const tokensUsed = result.tokensUsed || Math.ceil((userTask.length + text.length) / 4);

      console.log(`✓ Task completed in ${elapsed}ms, ~${tokensUsed} tokens`);

      await this.storage.logModelUsage(modelName, 1, tokensUsed);
      await this.storage.logTaskOutcome(modelName, taskType, true, tokensUsed);

      const usage = await this.storage.getModelUsage(modelName);
      const limits: ModelLimits = {
        rpm: { used: usage.rpmUsed, limit: modelInfo.rpmAllowed || 0 },
        tpm: { used: usage.tpmUsed, limit: modelInfo.tpmTotal || 0 },
        rpd: { used: usage.rpdUsed, limit: modelInfo.rpdTotal || 0 },
        tpd: { used: usage.tpdUsed, limit: modelInfo.tpdTotal || 0 },
      };

      return { success: true, response: text, modelUsed: modelName, tokensUsed, analysis, limits };
    } catch (error: any) {
      console.error(`✗ Execution failed with ${modelName}:`, error.message);
      await this.storage.logTaskOutcome(modelName, taskType, false, 0, error.message);

      const failureUsage = await this.storage.getModelUsage(modelName);
      const modelInfo2 = (await this.storage.getModelStats()).find(m => m.name === modelName);
      const failureLimits: ModelLimits = {
        rpm: { used: failureUsage.rpmUsed, limit: modelInfo2?.rpmAllowed || 0 },
        tpm: { used: failureUsage.tpmUsed, limit: modelInfo2?.tpmTotal || 0 },
        rpd: { used: failureUsage.rpdUsed, limit: modelInfo2?.rpdTotal || 0 },
        tpd: { used: failureUsage.tpdUsed, limit: modelInfo2?.tpdTotal || 0 },
      };

      const retryResult = await this.retryWithFallback(userTask, taskType, modelName, analysis);
      if (retryResult) return retryResult;

      return {
        success: false,
        error: error.message,
        modelUsed: modelName,
        tokensUsed: 0,
        analysis,
        limits: failureLimits,
      };
    }
  }

  private async retryWithFallback(
    userTask: string,
    taskType: string,
    failedModel: string,
    originalAnalysis: TaskAnalysis,
    triedModels: Set<string> = new Set(),
  ): Promise<TaskResult | null> {
    triedModels.add(failedModel);

    if (triedModels.size >= 3) {
      console.log("✗ Max retry attempts reached (3)");
      return null;
    }

    console.log(`\n⚠ Attempting retry with fallback model...`);

    const available = (await this.storage.getAllAvailableModels(originalAnalysis.estimatedTokens))
      .filter((m) => !triedModels.has(m.name));

    if (available.length === 0) {
      console.log("✗ No more fallback models available");
      return null;
    }

    for (const fallbackModel of available) {
      console.log(`  Using fallback: ${fallbackModel.name}`);

      try {
        const allModels = await this.storage.getModelStats();
        const modelInfo = allModels.find((m) => m.name === fallbackModel.name);
        if (!modelInfo) continue;

        try {
          AdapterFactory.getAdapter(modelInfo.origin);
        } catch (e: any) {
          console.log(`  Skipping ${fallbackModel.name}: ${e.message}`);
          triedModels.add(fallbackModel.name);
          continue;
        }

        const result = await this.executeWithModel(
          fallbackModel.name,
          userTask,
          taskType,
          { ...originalAnalysis, selectedModel: fallbackModel.name, reasoning: `Fallback after ${failedModel} failed` },
        );

        console.log(`✓ Fallback succeeded with ${fallbackModel.name}`);
        return result;
      } catch {
        triedModels.add(fallbackModel.name);
      }
    }

    console.log("✗ All fallback attempts failed");
    return null;
  }

  getAgentPrompt(): string {
    return this.agentPrompt;
  }

  getMainAgent(): MainAgent {
    return this.mainAgent;
  }
}
