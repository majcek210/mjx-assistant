import { IStorage } from "./storage/IStorage";
import { AdapterFactory } from "./adapters/AdapterFactory";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

export type TaskAnalysis = {
  selectedModel: string;
  reasoning: string;
  estimatedTokens: number;
  taskComplexity: "simple" | "moderate" | "complex";
};

type AgentConfig = {
  mainAgent: {
    model: string;
    origin: string;
    temperature: number;
    systemPrompt: string;
  };
  selectionStrategy: {
    failureRateThreshold: number;
    preferLowerRank: boolean;
    minTokenBuffer: number;
    fallbackEnabled: boolean;
  };
};

export class MainAgent {
  private storage: IStorage;
  private config: AgentConfig;
  private mainAgentModel: string;
  private mainAgentOrigin: string;

  constructor(storage: IStorage) {
    this.storage = storage;
    this.config = this.loadConfig();

    // Load main agent from .env or fallback to config.json
    const envMainAgent = process.env.MAIN_AGENT_MODEL;
    if (envMainAgent) {
      const [origin, ...modelParts] = envMainAgent.split(":");
      const model = modelParts.join(":");
      if (!origin || !model) {
        throw new Error(
          "MAIN_AGENT_MODEL must be in format 'origin:model' (e.g., google:gemini-2.5-flash)"
        );
      }
      this.mainAgentOrigin = origin;
      this.mainAgentModel = model;
      console.log(`✓ Main agent from .env: ${origin}:${model}`);
    } else {
      this.mainAgentOrigin = this.config.mainAgent.origin;
      this.mainAgentModel = this.config.mainAgent.model;
      console.log(`ℹ Main agent from config.json: ${this.mainAgentOrigin}:${this.mainAgentModel}`);
    }

    try {
      AdapterFactory.getAdapter(this.mainAgentOrigin);
    } catch (error: any) {
      throw new Error(`Failed to initialize main agent: ${error.message}`);
    }
  }

  private loadConfig(): AgentConfig {
    // Load from root config.json
    const configPath = path.join(process.cwd(), "config.json");
    const raw = fs.readFileSync(configPath, "utf-8");
    const data = JSON.parse(raw);

    // Provide safe defaults for selectionStrategy
    if (!data.selectionStrategy) {
      data.selectionStrategy = {
        failureRateThreshold: 20,
        preferLowerRank: true,
        minTokenBuffer: 100,
        fallbackEnabled: true,
      };
    }

    return data as AgentConfig;
  }

  /**
   * Analyze a task and select the most appropriate model.
   */
  async selectModelForTask(userTask: string): Promise<TaskAnalysis> {
    try {
      const availableModels = await this.getAvailableModelsWithStats();

      if (availableModels.length === 0) {
        throw new Error("No models available — all rate limits exceeded");
      }

      const { formatted } = await this.buildModelsContext(availableModels);
      const analysis = await this.consultMainAgent(userTask, formatted);

      const selectedModel = availableModels.find(
        (m) => m.name === analysis.selectedModel
      );

      if (!selectedModel) {
        console.warn(`⚠ Main agent selected unavailable model: ${analysis.selectedModel}`);
        return this.fallbackSelection(availableModels, analysis.estimatedTokens);
      }

      const hasCapacity = await this.verifyModelCapacity(
        selectedModel.name,
        analysis.estimatedTokens
      );

      if (!hasCapacity) {
        console.warn(`⚠ Selected model lacks capacity for ${analysis.estimatedTokens} tokens`);
        return this.fallbackSelection(availableModels, analysis.estimatedTokens);
      }

      return analysis;
    } catch (error) {
      console.error("Error in main agent selection:", error);
      // Emergency fallback: first available model
      const available = await this.storage.getAllAvailableModels(400);
      if (available.length > 0) {
        return {
          selectedModel: available[0].name,
          reasoning: "Emergency fallback due to main agent error",
          estimatedTokens: 400,
          taskComplexity: "moderate",
        };
      }
      throw new Error("No models available and main agent failed");
    }
  }

  /** Consult the main agent AI to select a model. */
  private async consultMainAgent(
    userTask: string,
    modelsContext: string
  ): Promise<TaskAnalysis> {
    console.log(`Using main agent: ${this.mainAgentModel}`);

    const prompt = `${this.config.mainAgent.systemPrompt}

AVAILABLE MODELS:
${modelsContext}

USER TASK:
"${userTask}"

Analyze this task and select the best model. Respond ONLY with valid JSON matching this format:
{
  "selectedModel": "model-name",
  "reasoning": "explanation of choice",
  "estimatedTokens": 500,
  "taskComplexity": "simple"
}`;

    const adapter = AdapterFactory.getAdapter(this.mainAgentOrigin);
    const result = await adapter.generateContent({
      model: this.mainAgentModel,
      prompt,
      temperature: this.config.mainAgent.temperature,
    });

    const text = result.text || "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("Main agent did not return valid JSON");

    const analysis: TaskAnalysis = JSON.parse(jsonMatch[0]);

    if (
      !analysis.selectedModel ||
      !analysis.reasoning ||
      !analysis.estimatedTokens ||
      !analysis.taskComplexity
    ) {
      throw new Error("Main agent response missing required fields");
    }

    return analysis;
  }

  /**
   * Get available models with stats, filtering out high-failure or unconfigured ones.
   * Pre-fetches failure rates to avoid async calls inside .filter().
   */
  private async getAvailableModelsWithStats() {
    const stats = await this.storage.getModelStats();

    // Pre-fetch failure rates in parallel (avoids async inside .filter)
    const failureRates = await Promise.all(
      stats.map((m) => this.storage.getModelFailureRate(m.name))
    );

    return stats.filter((model, i) => {
      if (!model.enabled) return false;

      try {
        AdapterFactory.getAdapter(model.origin);
      } catch {
        return false; // Provider not configured
      }

      if (failureRates[i] > this.config.selectionStrategy.failureRateThreshold) {
        console.log(`  ⚠ Filtering ${model.name}: failure rate ${failureRates[i].toFixed(1)}%`);
        return false;
      }

      const hasRPM = model.rpmAllowed - model.rpmUsed >= 1;
      const hasRPD = (model.rpdTotal ?? 0) - (model.rpdUsed ?? 0) >= 1;
      return hasRPM && hasRPD;
    });
  }

  /** Build formatted model context + parallel failure rates for formatModelsForAgent. */
  private async buildModelsContext(models: any[]): Promise<{ formatted: string; failureRates: number[] }> {
    const failureRates = await Promise.all(
      models.map((m) => this.storage.getModelFailureRate(m.name))
    );

    const formatted = models
      .map((m, i) => {
        const rpmAvail = m.rpmAllowed - m.rpmUsed;
        const tpmAvail = m.tpmTotal - m.tpmUsed;
        const total = m.successfulTasks + m.failedTasks;
        const successRate = total > 0
          ? ((m.successfulTasks / total) * 100).toFixed(1)
          : "N/A";

        return `- ${m.name} (${m.origin}, rank ${m.rank})
  Description: ${m.description}
  Available: ${rpmAvail} RPM, ${tpmAvail} TPM
  Success Rate: ${successRate}% (${m.successfulTasks} ok, ${m.failedTasks} failed)
  Recent Failure Rate: ${failureRates[i].toFixed(1)}%`;
      })
      .join("\n\n");

    return { formatted, failureRates };
  }

  private async verifyModelCapacity(
    modelName: string,
    estimatedTokens: number
  ): Promise<boolean> {
    const available = await this.storage.getAllAvailableModels(
      estimatedTokens + this.config.selectionStrategy.minTokenBuffer
    );
    return available.some((m) => m.name === modelName);
  }

  private fallbackSelection(availableModels: any[], estimatedTokens: number): TaskAnalysis {
    const suitable = availableModels
      .filter((m) => m.tpmTotal - m.tpmUsed >= estimatedTokens + this.config.selectionStrategy.minTokenBuffer)
      .sort((a, b) => a.rank - b.rank);

    const selected = suitable[0] ?? availableModels[0];
    return {
      selectedModel: selected.name,
      reasoning: "Fallback: highest-ranked available model with sufficient capacity",
      estimatedTokens,
      taskComplexity: "moderate",
    };
  }

  getMainAgentConfig() {
    return {
      model: this.mainAgentModel,
      origin: this.mainAgentOrigin,
      temperature: this.config.mainAgent.temperature,
      systemPrompt: this.config.mainAgent.systemPrompt,
    };
  }

  updateMainAgent(model: string, origin: string) {
    AdapterFactory.getAdapter(origin); // validates adapter exists
    this.mainAgentModel = model;
    this.mainAgentOrigin = origin;
    console.log(`✓ Main agent updated to: ${origin}:${model} (runtime only)`);
  }
}
