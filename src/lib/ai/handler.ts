import { ModelStore } from "./storage";
import fs from "fs";
import path from "path";

const Storage = new ModelStore("./db.sqlite");
const modelsFolder = "./src/lib/ai/models";

// --- Utility: standardized return function ---
function returnFunction<T>(status: boolean, message?: string, data?: T) {
  return status ? { success: true, data } : { success: false, message };
}

// --- Utility: parse a single JSON file ---
function parseFile(file: string) {
  const filePath = path.join(modelsFolder, file);
  const rawData = fs.readFileSync(filePath, "utf-8");
  return JSON.parse(rawData);
}

// --- Collect all models from folder ---
function collectModels() {
  try {
    const output: Record<string, any> = {};
    const files = fs.readdirSync(modelsFolder);

    for (const file of files) {
      if (!file.endsWith(".json")) continue;

      const jsonData = parseFile(file);
      if (!jsonData || !jsonData["origin"] || !jsonData.models) {
        return returnFunction(false, `Invalid JSON in file: ${file}`);
      }

      const categoryKey = jsonData["origin"];
      output[categoryKey] = jsonData.models;
    }

    return returnFunction(true, undefined, output);
  } catch (err) {
    console.log(err);
    return returnFunction(false, "Failed to collect models");
  }
}

// --- AI Handler Class ---
export class AiHandler {
  storage: ModelStore;

  constructor() {
    this.storage = Storage;
  }

  seed() {
    const result = collectModels();

    if (!result.success) {
      console.error("Failed to seed models:", result.message);
      return;
    }

    // Cast to Record<string, any[]> so TS knows we can index it by string
    const modelsData = result.data! as Record<string, any[]>;

    for (const origin in modelsData) {
      const modelsArray = modelsData[origin];

      console.log(modelsArray);
      const modelsToSeed = modelsArray.map((m: any) => {
        const model = {
          name: m.name,
          origin: origin,
          rank: m.rank || 0,
          description: m.description || "",
          enabled: true,
          rpm_used: 0,
          rpmAllowed: 0,
          tpm_used: 0,
          tpmTotal: m.limits?.tpm ?? 0,
          rpd_used: 0,
          rpdTotal: m.limits?.rpd ?? 0,
        };

        console.log("Prepared model:", model); // debug each on

        return model;
      });

      this.storage.seedModels(modelsToSeed as any);
    }

    console.log("All models have been seeded into the database.");
  }

  test() {
    // Log usage for "gemini-3-flash"
    this.storage.logModelUsage("gemini-3-flash", 1, 100, 1);

    // Get usage for "gemini-3-flash"
    const usage = this.storage.getModelUsage("gemini-3-flash");
    console.log("Current usage for gemini-3-flash:", usage);

    // Check available models
    const available = this.storage.getAllAvailableModels(400);
    console.log("Available models:", available);
  }
}
