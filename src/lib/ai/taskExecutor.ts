import { ModelStore } from "./storage";
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
  private storage: ModelStore;
  private mainAgent: MainAgent;
  private agentPrompt: string;

  constructor(storage: ModelStore) {
    this.storage = storage;
    this.mainAgent = new MainAgent(storage);

    // Load agent prompt from config.json
    try {
      const configPath = path.join(__dirname, "config.json");
      const configData = fs.readFileSync(configPath, "utf-8");
      const config = JSON.parse(configData);
      this.agentPrompt = config.mainAgent?.agentPrompt || "";
      if (this.agentPrompt) {
        console.log("✓ Agent instructions loaded from config.json");
      }
    } catch (error) {
      console.warn("⚠ Could not load agent instructions from config.json");
      this.agentPrompt = "";
    }

    // Check if at least one AI provider is configured
    const availableOrigins = AdapterFactory.getAvailableOrigins();
    if (availableOrigins.length === 0) {
      throw new Error(
        "No AI providers configured. Set at least one API key in .env (GEMINI_API_KEY or GROQ_API_KEY)",
      );
    }

    console.log(`✓ Available AI providers: ${availableOrigins.join(", ")}`);
  }

  /**
   * Execute a task using intelligent model selection.
   * The main agent analyzes the task and selects the best model.
   */
  async executeTask(
    userTask: string,
    taskType: string = "general",
  ): Promise<TaskResult> {
    console.log(`\n=== Executing Task ===`);
    console.log(`Task: "${userTask}"`);
    console.log(`Type: ${taskType}\n`);

    try {
      // Step 1: Use main agent to select the appropriate model
      console.log("Step 1: Consulting main agent for model selection...");
      const analysis = await this.mainAgent.selectModelForTask(userTask);

      const tools = await ToolExecutor.listTools();
      const formattedTools = tools
        .map((tool) => `- ${tool.name}: ${tool.description}`)
        .join("\n");

      const taskWithInstructions = this.agentPrompt
        ? `${this.agentPrompt}\n\nAvailable Tools:\n${formattedTools}\n\nUser Task: ${userTask}`
        : `Available Tools:\n${formattedTools}\nUser Task: ${userTask}`;
      // Step 2: Execute the task with the selected model
      console.log(`Step 2: Executing task with ${analysis.selectedModel}...`);
      const result = await this.executeWithModel(
        analysis.selectedModel,
        taskWithInstructions,
        taskType,
        analysis,
      );

      return result;
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

  /**
   * Execute a task with a specific model.
   */
  private async executeWithModel(
    modelName: string,
    userTask: string,
    taskType: string,
    analysis: TaskAnalysis,
  ): Promise<TaskResult> {
    // Get the model's origin from storage before try block
    const allModels = this.storage.getModelStats();
    const modelInfo = allModels.find((m) => m.name === modelName);

    if (!modelInfo) {
      throw new Error(`Model not found in database: ${modelName}`);
    }

    try {
      // Get the appropriate adapter
      const adapter = AdapterFactory.getAdapter(modelInfo.origin);

      const startTime = Date.now();
      const result = await adapter.generateContent({
        model: modelName,
        prompt: userTask,
      });
      const endTime = Date.now();

      const text = result.text || "";
      const tokensUsed =
        result.tokensUsed || Math.ceil((userTask.length + text.length) / 4);

      console.log(`✓ Task completed successfully in ${endTime - startTime}ms`);
      console.log(`  Tokens used: ~${tokensUsed}`);
      console.log(`  Response length: ${text.length} characters\n`);

      // Log usage and outcome
      this.storage.logModelUsage(modelName, 1, tokensUsed);
      this.storage.logTaskOutcome(modelName, taskType, true, tokensUsed);

      // Get current usage and build limits info
      const usage = this.storage.getModelUsage(modelName);
      const limits: ModelLimits = {
        rpm: { used: usage.rpmUsed, limit: modelInfo.rpmAllowed || 0 },
        tpm: { used: usage.tpmUsed, limit: modelInfo.tpmTotal || 0 },
        rpd: { used: usage.rpdUsed, limit: modelInfo.rpdTotal || 0 },
        tpd: { used: usage.tpdUsed, limit: modelInfo.tpdTotal || 0 },
      };

      return {
        success: true,
        response: text,
        modelUsed: modelName,
        tokensUsed: tokensUsed,
        analysis: analysis,
        limits: limits,
      };
    } catch (error: any) {
      console.error(`✗ Execution failed with ${modelName}:`, error.message);

      // Log the failure
      this.storage.logTaskOutcome(modelName, taskType, false, 0, error.message);

      // Get usage info for failed model
      const failureUsage = this.storage.getModelUsage(modelName);
      const failureLimits: ModelLimits = {
        rpm: { used: failureUsage.rpmUsed, limit: modelInfo.rpmAllowed || 0 },
        tpm: { used: failureUsage.tpmUsed, limit: modelInfo.tpmTotal || 0 },
        rpd: { used: failureUsage.rpdUsed, limit: modelInfo.rpdTotal || 0 },
        tpd: { used: failureUsage.tpdUsed, limit: modelInfo.tpdTotal || 0 },
      };

      // Attempt retry with next best model if configured
      const retryResult = await this.retryWithFallback(
        userTask,
        taskType,
        modelName,
        analysis,
      );

      if (retryResult) {
        return retryResult;
      }

      return {
        success: false,
        error: error.message,
        modelUsed: modelName,
        tokensUsed: 0,
        analysis: analysis,
        limits: failureLimits,
      };
    }
  }

  /**
   * Retry the task with a fallback model if the first one fails.
   * Prevents infinite loops by tracking failed models.
   */
  private async retryWithFallback(
    userTask: string,
    taskType: string,
    failedModel: string,
    originalAnalysis: TaskAnalysis,
    triedModels: Set<string> = new Set(),
  ): Promise<TaskResult | null> {
    // Add failed model to tried set
    triedModels.add(failedModel);

    // Max 3 retry attempts total
    if (triedModels.size >= 3) {
      console.log("✗ Max retry attempts reached (3)\n");
      return null;
    }

    console.log(`\n⚠ Attempting retry with fallback model...`);

    // Get available models, excluding already tried ones
    const available = this.storage
      .getAllAvailableModels(originalAnalysis.estimatedTokens)
      .filter((m) => !triedModels.has(m.name));

    if (available.length === 0) {
      console.log("✗ No more fallback models available");
      return null;
    }

    // Try each available model until one works
    for (const fallbackModel of available) {
      console.log(`  Using fallback: ${fallbackModel.name}`);

      try {
        // Check if adapter is available before trying
        const modelInfo = this.storage
          .getModelStats()
          .find((m) => m.name === fallbackModel.name);
        if (!modelInfo) continue;

        try {
          AdapterFactory.getAdapter(modelInfo.origin);
        } catch (error: any) {
          console.log(`  Skipping ${fallbackModel.name}: ${error.message}`);
          triedModels.add(fallbackModel.name);
          continue;
        }

        const result = await this.executeWithModel(
          fallbackModel.name,
          userTask,
          taskType,
          {
            ...originalAnalysis,
            selectedModel: fallbackModel.name,
            reasoning: `Fallback after ${failedModel} failed`,
          },
        );

        console.log(`✓ Fallback execution succeeded\n`);
        return result;
      } catch (error) {
        console.log(`✗ ${fallbackModel.name} also failed`);
        triedModels.add(fallbackModel.name);
        // Continue to next model
      }
    }

    console.log("✗ All fallback attempts failed\n");
    return null;
  }

  /**
   * Get the loaded agent prompt.
   */
  getAgentPrompt(): string {
    return this.agentPrompt;
  }

  /**
   * Get the main agent instance for configuration.
   */
  getMainAgent(): MainAgent {
    return this.mainAgent;
  }
}
