"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TaskExecutor = void 0;
const mainAgent_1 = require("./mainAgent");
const AdapterFactory_1 = require("./adapters/AdapterFactory");
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
class TaskExecutor {
    constructor(storage) {
        this.storage = storage;
        this.mainAgent = new mainAgent_1.MainAgent(storage);
        // Check if at least one AI provider is configured
        const availableOrigins = AdapterFactory_1.AdapterFactory.getAvailableOrigins();
        if (availableOrigins.length === 0) {
            throw new Error("No AI providers configured. Set at least one API key in .env (GEMINI_API_KEY or GROQ_API_KEY)");
        }
        console.log(`✓ Available AI providers: ${availableOrigins.join(", ")}`);
    }
    /**
     * Execute a task using intelligent model selection.
     * The main agent analyzes the task and selects the best model.
     */
    async executeTask(userTask, taskType = "general") {
        console.log(`\n=== Executing Task ===`);
        console.log(`Task: "${userTask}"`);
        console.log(`Type: ${taskType}\n`);
        try {
            // Step 1: Use main agent to select the appropriate model
            console.log("Step 1: Consulting main agent for model selection...");
            const analysis = await this.mainAgent.selectModelForTask(userTask);
            console.log(`✓ Main agent selected: ${analysis.selectedModel}`);
            console.log(`  Reasoning: ${analysis.reasoning}`);
            console.log(`  Complexity: ${analysis.taskComplexity}`);
            console.log(`  Estimated tokens: ${analysis.estimatedTokens}\n`);
            // Step 2: Execute the task with the selected model
            console.log(`Step 2: Executing task with ${analysis.selectedModel}...`);
            const result = await this.executeWithModel(analysis.selectedModel, userTask, taskType, analysis);
            return result;
        }
        catch (error) {
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
    async executeWithModel(modelName, userTask, taskType, analysis) {
        try {
            // Get the model's origin from storage
            const allModels = this.storage.getModelStats();
            const modelInfo = allModels.find((m) => m.name === modelName);
            if (!modelInfo) {
                throw new Error(`Model not found in database: ${modelName}`);
            }
            // Get the appropriate adapter
            const adapter = AdapterFactory_1.AdapterFactory.getAdapter(modelInfo.origin);
            const startTime = Date.now();
            const result = await adapter.generateContent({
                model: modelName,
                prompt: userTask,
            });
            const endTime = Date.now();
            const text = result.text || "";
            const tokensUsed = result.tokensUsed || Math.ceil((userTask.length + text.length) / 4);
            console.log(`✓ Task completed successfully in ${endTime - startTime}ms`);
            console.log(`  Tokens used: ~${tokensUsed}`);
            console.log(`  Response length: ${text.length} characters\n`);
            // Log usage and outcome
            this.storage.logModelUsage(modelName, 1, tokensUsed);
            this.storage.logTaskOutcome(modelName, taskType, true, tokensUsed);
            return {
                success: true,
                response: text,
                modelUsed: modelName,
                tokensUsed: tokensUsed,
                analysis: analysis,
            };
        }
        catch (error) {
            console.error(`✗ Execution failed with ${modelName}:`, error.message);
            // Log the failure
            this.storage.logTaskOutcome(modelName, taskType, false, 0, error.message);
            // Attempt retry with next best model if configured
            const retryResult = await this.retryWithFallback(userTask, taskType, modelName, analysis);
            if (retryResult) {
                return retryResult;
            }
            return {
                success: false,
                error: error.message,
                modelUsed: modelName,
                tokensUsed: 0,
                analysis: analysis,
            };
        }
    }
    /**
     * Retry the task with a fallback model if the first one fails.
     * Prevents infinite loops by tracking failed models.
     */
    async retryWithFallback(userTask, taskType, failedModel, originalAnalysis, triedModels = new Set()) {
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
                const modelInfo = this.storage.getModelStats().find(m => m.name === fallbackModel.name);
                if (!modelInfo)
                    continue;
                try {
                    AdapterFactory_1.AdapterFactory.getAdapter(modelInfo.origin);
                }
                catch (error) {
                    console.log(`  Skipping ${fallbackModel.name}: ${error.message}`);
                    triedModels.add(fallbackModel.name);
                    continue;
                }
                const result = await this.executeWithModel(fallbackModel.name, userTask, taskType, {
                    ...originalAnalysis,
                    selectedModel: fallbackModel.name,
                    reasoning: `Fallback after ${failedModel} failed`,
                });
                console.log(`✓ Fallback execution succeeded\n`);
                return result;
            }
            catch (error) {
                console.log(`✗ ${fallbackModel.name} also failed`);
                triedModels.add(fallbackModel.name);
                // Continue to next model
            }
        }
        console.log("✗ All fallback attempts failed\n");
        return null;
    }
    /**
     * Get the main agent instance for configuration.
     */
    getMainAgent() {
        return this.mainAgent;
    }
}
exports.TaskExecutor = TaskExecutor;
