"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GoogleAdapter = void 0;
const genai_1 = require("@google/genai");
const AIAdapter_1 = require("./AIAdapter");
class GoogleAdapter extends AIAdapter_1.AIAdapter {
    constructor(apiKey) {
        super(apiKey);
        this.client = new genai_1.GoogleGenAI({ apiKey });
    }
    async generateContent(params) {
        try {
            const result = await this.client.models.generateContent({
                model: params.model,
                contents: params.prompt,
            });
            const text = result.text || "";
            // Estimate tokens (rough approximation: 1 token ≈ 4 characters)
            const tokensUsed = Math.ceil((params.prompt.length + text.length) / 4);
            return {
                text,
                tokensUsed,
            };
        }
        catch (error) {
            throw new Error(`Google AI API error: ${error.message}`);
        }
    }
    getOrigin() {
        return "google";
    }
    supportsModel(modelName) {
        // Google models typically start with "gemini" or "gemma"
        return (modelName.startsWith("gemini") ||
            modelName.startsWith("gemma") ||
            modelName.startsWith("models/"));
    }
}
exports.GoogleAdapter = GoogleAdapter;
