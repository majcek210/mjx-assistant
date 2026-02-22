import { AiHandler } from "../lib/ai/handler";

const AIAgent = new AiHandler();

// Seed model definitions into the database on startup (safe to re-run — uses upsert).
AIAgent.seed().catch((err) => console.error("⚠ Model seeding failed:", err));

export default AIAgent;
