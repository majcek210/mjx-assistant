"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MainAgent = void 0;
const AdapterFactory_1 = require("./adapters/AdapterFactory");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
class MainAgent {
    constructor(storage) {
        this.storage = storage;
        this.config = this.loadConfig();
        // Load main agent from .env or fallback to config.json
        const envMainAgent = process.env.MAIN_AGENT_MODEL;
        if (envMainAgent) {
            const [origin, model] = envMainAgent.split(":");
            if (!origin || !model) {
                throw new Error("MAIN_AGENT_MODEL must be in format 'origin:model' (e.g., google:gemini-2.5-flash)");
            }
            this.mainAgentOrigin = origin;
            this.mainAgentModel = model;
            console.log(`✓ Main agent loaded from .env: ${origin}:${model}`);
        }
        else {
            // Fallback to config.json
            this.mainAgentOrigin = this.config.mainAgent.origin;
            this.mainAgentModel = this.config.mainAgent.model;
            console.log(`ℹ Main agent from config.json: ${this.mainAgentOrigin}:${this.mainAgentModel}`);
            console.log("  Tip: Set MAIN_AGENT_MODEL in .env to override");
        }
        // Verify the adapter is available
        try {
            AdapterFactory_1.AdapterFactory.getAdapter(this.mainAgentOrigin);
        }
        catch (error) {
            throw new Error(`Failed to initialize main agent: ${error.message}`);
        }
    }
    loadConfig() {
        const configPath = path_1.default.join(__dirname, "config.json");
        const rawData = fs_1.default.readFileSync(configPath, "utf-8");
        return JSON.parse(rawData);
    }
    /**
     * Analyze a task and select the most appropriate model.
     * Uses the configured main agent to make an intelligent decision.
     */
    async selectModelForTask(userTask) {
        try {
            // Get available models with their current stats
            const availableModels = this.getAvailableModelsWithStats();
            if (availableModels.length === 0) {
                throw new Error("No models available - all rate limits exceeded");
            }
            // Prepare context for the main agent
            const modelsContext = this.formatModelsForAgent(availableModels);
            // Ask the main agent to analyze and select
            const analysis = await this.consultMainAgent(userTask, modelsContext);
            // Validate the selected model is actually available
            const selectedModel = availableModels.find((m) => m.name === analysis.selectedModel);
            if (!selectedModel) {
                console.warn(`⚠ Main agent selected unavailable model: ${analysis.selectedModel}`);
                // Fallback to best available model
                return this.fallbackSelection(availableModels, analysis.estimatedTokens);
            }
            // Double-check the model has capacity for the estimated tokens
            const hasCapacity = this.verifyModelCapacity(selectedModel.name, analysis.estimatedTokens);
            if (!hasCapacity) {
                console.warn(`⚠ Selected model lacks capacity for ${analysis.estimatedTokens} tokens`);
                return this.fallbackSelection(availableModels, analysis.estimatedTokens);
            }
            return analysis;
        }
        catch (error) {
            console.error("Error in main agent selection:", error);
            // Emergency fallback: select first available model
            const available = this.storage.getAllAvailableModels(400);
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
    /**
     * Consult the main agent AI to analyze the task and select a model.
     */
    async consultMainAgent(userTask, modelsContext) {
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
        // Get the adapter for the main agent's origin
        const adapter = AdapterFactory_1.AdapterFactory.getAdapter(this.mainAgentOrigin);
        const result = await adapter.generateContent({
            model: this.mainAgentModel,
            prompt: prompt,
            temperature: this.config.mainAgent.temperature,
        });
        const text = result.text || "";
        // Extract JSON from response (handle markdown code blocks)
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            throw new Error("Main agent did not return valid JSON");
        }
        const analysis = JSON.parse(jsonMatch[0]);
        // Validate the response structure
        if (!analysis.selectedModel ||
            !analysis.reasoning ||
            !analysis.estimatedTokens ||
            !analysis.taskComplexity) {
            throw new Error("Main agent response missing required fields");
        }
        return analysis;
    }
    /**
     * Get available models with their statistics for decision-making.
     * Filters out models with high failure rates and unavailable providers.
     */
    getAvailableModelsWithStats() {
        const stats = this.storage.getModelStats();
        return stats
            .filter((model) => {
            if (!model.enabled)
                return false;
            // Check if adapter is available for this model's origin
            try {
                AdapterFactory_1.AdapterFactory.getAdapter(model.origin);
            }
            catch (error) {
                // Provider not configured, skip this model silently
                return false;
            }
            // Check failure rate
            const failureRate = this.storage.getModelFailureRate(model.name);
            if (failureRate > this.config.selectionStrategy.failureRateThreshold) {
                console.log(`  ⚠ Filtering out ${model.name} due to high failure rate: ${failureRate.toFixed(1)}%`);
                return false;
            }
            // Must have some capacity
            const hasRPM = model.rpmAllowed - model.rpmUsed >= 1;
            const hasRPD = model.rpdTotal - model.rpdUsed >= 1;
            return hasRPM && hasRPD;
        })
            .sort((a, b) => {
            // Sort by origin first, then rank within origin
            if (a.origin !== b.origin) {
                return a.origin.localeCompare(b.origin);
            }
            return a.rank - b.rank;
        });
    }
    /**
     * Format model information for the main agent to understand.
     */
    formatModelsForAgent(models) {
        return models
            .map((m) => {
            const rpmAvail = m.rpmAllowed - m.rpmUsed;
            const tpmAvail = m.tpmTotal - m.tpmUsed;
            const failureRate = this.storage.getModelFailureRate(m.name);
            const successRate = m.successfulTasks + m.failedTasks > 0
                ? ((m.successfulTasks / (m.successfulTasks + m.failedTasks)) * 100).toFixed(1)
                : "N/A";
            return `- ${m.name} (${m.origin}, rank ${m.rank})
  Description: ${m.description}
  Available: ${rpmAvail} RPM, ${tpmAvail} TPM
  Success Rate: ${successRate}% (${m.successfulTasks} succeeded, ${m.failedTasks} failed)
  Recent Failure Rate: ${failureRate.toFixed(1)}%`;
        })
            .join("\n\n");
    }
    /**
     * Verify a model has capacity for the estimated tokens.
     */
    verifyModelCapacity(modelName, estimatedTokens) {
        const available = this.storage.getAllAvailableModels(estimatedTokens + this.config.selectionStrategy.minTokenBuffer);
        return available.some((m) => m.name === modelName);
    }
    /**
     * Fallback selection strategy when main agent fails or selects invalid model.
     * Selects the highest-ranked (lowest rank number) available model.
     */
    fallbackSelection(availableModels, estimatedTokens) {
        // Filter by token capacity and sort by rank
        const suitable = availableModels
            .filter((m) => {
            const tpmAvail = m.tpmTotal - m.tpmUsed;
            return tpmAvail >= estimatedTokens + this.config.selectionStrategy.minTokenBuffer;
        })
            .sort((a, b) => a.rank - b.rank);
        if (suitable.length === 0) {
            // Emergency: just pick first available
            const emergency = availableModels[0];
            return {
                selectedModel: emergency.name,
                reasoning: "Emergency fallback - selected first available model",
                estimatedTokens: estimatedTokens,
                taskComplexity: "moderate",
            };
        }
        const selected = suitable[0];
        return {
            selectedModel: selected.name,
            reasoning: `Fallback selection: highest-ranked available model with sufficient capacity`,
            estimatedTokens: estimatedTokens,
            taskComplexity: "moderate",
        };
    }
    /**
     * Get the current main agent configuration.
     */
    getMainAgentConfig() {
        return {
            model: this.mainAgentModel,
            origin: this.mainAgentOrigin,
            temperature: this.config.mainAgent.temperature,
            systemPrompt: this.config.mainAgent.systemPrompt,
        };
    }
    /**
     * Update the main agent configuration.
     * Useful for switching between different main agent models.
     * Note: This only updates the runtime config, not .env or config.json
     */
    updateMainAgent(model, origin) {
        // Verify the adapter is available
        AdapterFactory_1.AdapterFactory.getAdapter(origin);
        this.mainAgentModel = model;
        this.mainAgentOrigin = origin;
        console.log(`✓ Main agent updated to: ${origin}:${model}`);
        console.log("  (Runtime only - update .env to persist)");
    }
}
exports.MainAgent = MainAgent;
