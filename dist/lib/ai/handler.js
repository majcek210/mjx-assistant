"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AiHandler = void 0;
const storage_1 = require("./storage");
const taskExecutor_1 = require("./taskExecutor");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const Storage = new storage_1.ModelStore("src/lib/ai/db.sqlite");
const modelsFolder = "./src/lib/ai/models";
// --- Utility: standardized return function ---
function returnFunction(status, message, data) {
    return status ? { success: true, data } : { success: false, message };
}
// --- Utility: parse a single JSON file ---
function parseFile(file) {
    const filePath = path_1.default.join(modelsFolder, file);
    const rawData = fs_1.default.readFileSync(filePath, "utf-8");
    return JSON.parse(rawData);
}
// --- Collect all models from folder ---
function collectModels() {
    try {
        const output = {};
        const files = fs_1.default.readdirSync(modelsFolder);
        for (const file of files) {
            if (!file.endsWith(".json"))
                continue;
            const jsonData = parseFile(file);
            if (!jsonData || !jsonData["origin"] || !jsonData.models) {
                return returnFunction(false, `Invalid JSON in file: ${file}`);
            }
            const categoryKey = jsonData["origin"];
            output[categoryKey] = jsonData.models;
        }
        return returnFunction(true, undefined, output);
    }
    catch (err) {
        console.log(err);
        return returnFunction(false, "Failed to collect models");
    }
}
// --- AI Handler Class ---
class AiHandler {
    constructor() {
        this.storage = Storage;
        this.executor = new taskExecutor_1.TaskExecutor(this.storage);
    }
    seed() {
        const result = collectModels();
        if (!result.success) {
            console.error("Failed to seed models:", result.message);
            return;
        }
        // Cast to Record<string, any[]> so TS knows we can index it by string
        const modelsData = result.data;
        for (const origin in modelsData) {
            const modelsArray = modelsData[origin];
            const modelsToSeed = modelsArray.map((m) => {
                const model = {
                    name: m.name,
                    origin: origin,
                    rank: m.rank || 0,
                    description: m.description || "",
                    enabled: true,
                    rpmAllowed: m.limits?.rpm ?? 0,
                    tpmTotal: m.limits?.tpm ?? 0,
                    rpdTotal: m.limits?.rpd ?? 0,
                    tpdTotal: m.limits?.tpd,
                };
                return model;
            });
            this.storage.seedModels(modelsToSeed);
        }
        console.log("All models have been seeded into the database.");
    }
    async ask(task, type) {
        console.log("═══ Excuting a task ═══\n");
        try {
            const result = await this.executor.executeTask(task, type);
            if (result.success) {
                console.log("Task Result:");
                console.log(`  Model: ${result.modelUsed}`);
                console.log(`  Complexity: ${result.analysis.taskComplexity}`);
                console.log(`  Tokens Used: ${result.tokensUsed}`);
                console.log(`  Response: "${result.response?.substring(0, 100)}..."\n`);
                return result;
            }
            else {
                console.log(`✗ Task failed: ${result.error}\n`);
            }
        }
        catch (error) {
            console.log(`Task failed`);
        }
    }
    async test() {
        console.log("\n╔══════════════════════════════════════════════════════════════╗");
        console.log("║         TESTING INTELLIGENT AI AGENT SYSTEM                 ║");
        console.log("╚══════════════════════════════════════════════════════════════╝\n");
        // Test 1: Display initial model statistics
        console.log("═══ Test 1: Initial Model Statistics ═══\n");
        const initialStats = this.storage.getModelStats();
        console.log(`Total models: ${initialStats.length}\n`);
        initialStats.slice(0, 3).forEach((stat) => {
            console.log(`${stat.name} (${stat.origin}):`);
            console.log(`  Rank: ${stat.rank} | Enabled: ${stat.enabled ? "✓" : "✗"}`);
            console.log(`  Limits: ${stat.rpmAllowed} RPM, ${stat.tpmTotal} TPM`);
            console.log(`  Tasks: ${stat.successfulTasks} succeeded, ${stat.failedTasks} failed\n`);
        });
        // Test 2: Main agent configuration
        console.log("═══ Test 2: Main Agent Configuration ═══\n");
        const mainAgentConfig = this.executor.getMainAgent().getMainAgentConfig();
        console.log(`Main Agent Model: ${mainAgentConfig.model}`);
        console.log(`Origin: ${mainAgentConfig.origin}`);
        console.log(`Temperature: ${mainAgentConfig.temperature}\n`);
        // Test 3: Execute simple task
        console.log("═══ Test 3: Execute Simple Task ═══\n");
        try {
            const result1 = await this.executor.executeTask("What is 2+2? Give a very brief answer.", "math");
            if (result1.success) {
                console.log("Task Result:");
                console.log(`  Model: ${result1.modelUsed}`);
                console.log(`  Complexity: ${result1.analysis.taskComplexity}`);
                console.log(`  Tokens Used: ${result1.tokensUsed}`);
                console.log(`  Response: "${result1.response?.substring(0, 100)}..."\n`);
            }
            else {
                console.log(`✗ Task failed: ${result1.error}\n`);
            }
        }
        catch (error) {
            console.log(`⚠ Test 3 skipped: ${error.message}\n`);
        }
        // Test 4: Execute complex task
        console.log("═══ Test 4: Execute Complex Task ═══\n");
        try {
            const result2 = await this.executor.executeTask("Explain quantum computing in one sentence.", "explanation");
            if (result2.success) {
                console.log("Task Result:");
                console.log(`  Model: ${result2.modelUsed}`);
                console.log(`  Complexity: ${result2.analysis.taskComplexity}`);
                console.log(`  Tokens Used: ${result2.tokensUsed}`);
                console.log(`  Response: "${result2.response?.substring(0, 100)}..."\n`);
            }
            else {
                console.log(`✗ Task failed: ${result2.error}\n`);
            }
        }
        catch (error) {
            console.log(`⚠ Test 4 skipped: ${error.message}\n`);
        }
        // Test 5: Check updated statistics after tasks
        console.log("═══ Test 5: Post-Execution Statistics ═══\n");
        const finalStats = this.storage.getModelStats();
        finalStats.slice(0, 3).forEach((stat) => {
            const failureRate = this.storage.getModelFailureRate(stat.name);
            const successfulTasks = stat.successfulTasks || 0;
            const failedTasks = stat.failedTasks || 0;
            const totalTasks = successfulTasks + failedTasks;
            const successRate = totalTasks > 0
                ? ((successfulTasks / totalTasks) * 100).toFixed(1)
                : "N/A";
            console.log(`${stat.name}:`);
            console.log(`  Usage: ${stat.rpmUsed}/${stat.rpmAllowed} RPM, ${stat.tpmUsed}/${stat.tpmTotal} TPM`);
            console.log(`  Tasks: ${successfulTasks} ✓ / ${failedTasks} ✗ (${successRate}% success)`);
            console.log(`  Recent Failure Rate: ${failureRate.toFixed(1)}%\n`);
        });
        // Test 6: Test rate limiting
        console.log("═══ Test 6: Rate Limiting Test ═══\n");
        const available = this.storage.getAllAvailableModels(400);
        console.log(`Available models (≥400 tokens): ${available.length}`);
        available.forEach((m) => {
            const usage = this.storage.getModelUsage(m.name);
            const rpmAvail = m.rpmAllowed - usage.rpmUsed;
            const tpmAvail = m.tpmTotal - usage.tpmUsed;
            console.log(`  ✓ ${m.name}: ${rpmAvail}/${m.rpmAllowed} RPM, ${tpmAvail}/${m.tpmTotal} TPM available`);
        });
        // Test 7: Database maintenance
        console.log("\n═══ Test 7: Database Maintenance ═══\n");
        const cleanedUsage = this.storage.cleanupOldLogs();
        const cleanedTasks = this.storage.cleanupOldTaskLogs(7);
        console.log(`Cleaned ${cleanedUsage} old usage logs (>24h)`);
        console.log(`Cleaned ${cleanedTasks} old task logs (>7 days)\n`);
        console.log("╔══════════════════════════════════════════════════════════════╗");
        console.log("║                    TESTING COMPLETE                          ║");
        console.log("╚══════════════════════════════════════════════════════════════╝\n");
    }
}
exports.AiHandler = AiHandler;
