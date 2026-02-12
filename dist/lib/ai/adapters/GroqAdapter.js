"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GroqAdapter = void 0;
const AIAdapter_1 = require("./AIAdapter");
/**
 * Groq AI Adapter
 *
 * To use this adapter:
 * 1. Install the Groq SDK: npm install groq-sdk
 * 2. Set GROQ_API_KEY in your .env file
 * 3. Add Groq models to src/lib/ai/models/groq.json
 *
 * Groq models include:
 * - llama-3.3-70b-versatile (fastest, most capable)
 * - llama-3.1-8b-instant (fastest, lightweight)
 * - mixtral-8x7b-32768 (good for long context)
 */
class GroqAdapter extends AIAdapter_1.AIAdapter {
    constructor(apiKey) {
        super(apiKey);
        try {
            // Dynamically import Groq SDK if available
            const { Groq } = require("groq-sdk");
            this.client = new Groq({ apiKey });
        }
        catch (error) {
            throw new Error("Groq SDK not installed. Run: npm install groq-sdk");
        }
    }
    async generateContent(params) {
        try {
            const completion = await this.client.chat.completions.create({
                model: params.model,
                messages: [
                    {
                        role: "user",
                        content: params.prompt,
                    },
                ],
                temperature: params.temperature ?? 0.7,
                max_tokens: params.maxTokens,
            });
            const text = completion.choices[0]?.message?.content || "";
            const tokensUsed = completion.usage?.total_tokens ||
                Math.ceil((params.prompt.length + text.length) / 4);
            return {
                text,
                tokensUsed,
            };
        }
        catch (error) {
            throw new Error(`Groq API error: ${error.message}`);
        }
    }
    getOrigin() {
        return "groq";
    }
    supportsModel(modelName) {
        // Groq models include llama, mixtral, etc.
        const groqModels = [
            "llama",
            "mixtral",
            "gemma",
            "whisper",
            "llama-guard",
        ];
        return groqModels.some((prefix) => modelName.toLowerCase().includes(prefix));
    }
}
exports.GroqAdapter = GroqAdapter;
