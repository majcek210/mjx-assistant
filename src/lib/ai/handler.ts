import { IStorage } from "./storage/IStorage";
import { StorageFactory } from "./storage/StorageFactory";
import { TaskExecutor } from "./taskExecutor";
import fs from "fs";
import path from "path";

const modelsFolder = path.join(__dirname, "models");

function parseFile(file: string) {
  const filePath = path.join(modelsFolder, file);
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function collectModels(): { success: boolean; data?: Record<string, any[]>; message?: string } {
  try {
    const output: Record<string, any[]> = {};
    const files = fs.readdirSync(modelsFolder);

    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const jsonData = parseFile(file);
      if (!jsonData?.origin || !jsonData.models) {
        return { success: false, message: `Invalid JSON in file: ${file}` };
      }
      output[jsonData.origin] = jsonData.models;
    }

    return { success: true, data: output };
  } catch (err) {
    console.error(err);
    return { success: false, message: "Failed to collect models" };
  }
}

export class AiHandler {
  storage: IStorage;
  executor: TaskExecutor;

  constructor() {
    this.storage = StorageFactory.create();
    this.executor = new TaskExecutor(this.storage);
  }

  async seed(): Promise<void> {
    const result = collectModels();

    if (!result.success) {
      console.error("Failed to seed models:", result.message);
      return;
    }

    const modelsData = result.data!;

    for (const origin in modelsData) {
      const modelsToSeed = modelsData[origin].map((m: any) => ({
        name: m.name,
        origin,
        rank: m.rank || 0,
        description: m.description || "",
        enabled: true,
        rpmAllowed: m.limits?.rpm ?? 0,
        tpmTotal: m.limits?.tpm ?? 0,
        rpdTotal: m.limits?.rpd ?? 0,
        tpdTotal: m.limits?.tpd,
      }));

      await this.storage.seedModels(modelsToSeed as any);
    }

    console.log("✓ All models seeded.");
  }

  async ask(task: string, type: string | undefined, context?: string) {
    console.log("═══ Executing task ═══\n");
    try {
      const result = await this.executor.executeTask(task, type, context);

      if (result.success) {
        console.log(`  Model: ${result.modelUsed}`);
        console.log(`  Complexity: ${result.analysis.taskComplexity}`);
        console.log(`  Tokens: ${result.tokensUsed}`);
        console.log(`  Response: "${result.response?.substring(0, 100)}..."\n`);
        return result;
      } else {
        console.log(`✗ Task failed: ${result.error}\n`);
        return result;
      }
    } catch (error: any) {
      console.error("Task threw:", error.message);
    }
  }

  async test() {
    console.log("\n╔══════════════════════════════════════════════════════════════╗");
    console.log("║         TESTING INTELLIGENT AI AGENT SYSTEM                 ║");
    console.log("╚══════════════════════════════════════════════════════════════╝\n");

    console.log("═══ Test 1: Initial Model Statistics ═══\n");
    const initialStats = await this.storage.getModelStats();
    console.log(`Total models: ${initialStats.length}\n`);
    initialStats.slice(0, 3).forEach((stat) => {
      console.log(`${stat.name} (${stat.origin}):`);
      console.log(`  Rank: ${stat.rank} | Enabled: ${stat.enabled ? "✓" : "✗"}`);
      console.log(`  Limits: ${stat.rpmAllowed} RPM, ${stat.tpmTotal} TPM`);
      console.log(`  Tasks: ${stat.successfulTasks} succeeded, ${stat.failedTasks} failed\n`);
    });

    console.log("═══ Test 2: Main Agent Configuration ═══\n");
    const mainAgentConfig = this.executor.getMainAgent().getMainAgentConfig();
    console.log(`Main Agent: ${mainAgentConfig.origin}:${mainAgentConfig.model}`);
    console.log(`Temperature: ${mainAgentConfig.temperature}\n`);

    console.log("═══ Test 3: Simple Task ═══\n");
    try {
      const r1 = await this.executor.executeTask("What is 2+2? Give a very brief answer.", "math");
      console.log(r1.success ? `✓ ${r1.modelUsed}: "${r1.response?.substring(0, 100)}"` : `✗ ${r1.error}`);
    } catch (e: any) {
      console.log(`⚠ Skipped: ${e.message}`);
    }

    console.log("═══ Test 4: Complex Task ═══\n");
    try {
      const r2 = await this.executor.executeTask("Explain quantum computing in one sentence.", "explanation");
      console.log(r2.success ? `✓ ${r2.modelUsed}: "${r2.response?.substring(0, 100)}"` : `✗ ${r2.error}`);
    } catch (e: any) {
      console.log(`⚠ Skipped: ${e.message}`);
    }

    console.log("═══ Test 5: Post-Execution Statistics ═══\n");
    const finalStats = await this.storage.getModelStats();
    for (const stat of finalStats.slice(0, 3)) {
      const failureRate = await this.storage.getModelFailureRate(stat.name);
      const total = (stat.successfulTasks || 0) + (stat.failedTasks || 0);
      const successRate = total > 0
        ? (((stat.successfulTasks || 0) / total) * 100).toFixed(1)
        : "N/A";
      console.log(`${stat.name}: ${stat.rpmUsed}/${stat.rpmAllowed} RPM | ${successRate}% success | ${failureRate.toFixed(1)}% failures\n`);
    }

    console.log("═══ Test 6: Database Maintenance ═══\n");
    const cleanedUsage = await this.storage.cleanupOldLogs();
    const cleanedTasks = await this.storage.cleanupOldTaskLogs(7);
    console.log(`Cleaned ${cleanedUsage} usage logs, ${cleanedTasks} task logs\n`);

    console.log("╔══════════════════════════════════════════════════════════════╗");
    console.log("║                    TESTING COMPLETE                          ║");
    console.log("╚══════════════════════════════════════════════════════════════╝\n");
  }
}
