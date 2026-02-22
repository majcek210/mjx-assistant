import * as executor from "../lib/ai/toolExecutor";

const ToolExecutor = new executor.ToolExecutor();

// Kick off initialization; executeTool() will await this automatically.
ToolExecutor.initialize().catch((err) => console.error("⚠ Tool initialization failed:", err));

export default ToolExecutor;
