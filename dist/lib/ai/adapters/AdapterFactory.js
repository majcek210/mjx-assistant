"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AdapterFactory = void 0;
const GoogleAdapter_1 = require("./GoogleAdapter");
const GroqAdapter_1 = require("./GroqAdapter");
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
/**
 * Factory for creating AI adapters based on origin/provider.
 *
 * Supported providers:
 * - google: Google Gemini/Gemma models (requires GEMINI_API_KEY)
 * - groq: Groq LLaMA/Mixtral models (requires GROQ_API_KEY)
 *
 * To add a new provider:
 * 1. Create a new adapter class extending AIAdapter
 * 2. Add the origin to getAdapter() method
 * 3. Add API key environment variable
 * 4. Add models JSON file to src/lib/ai/models/{origin}.json
 */
class AdapterFactory {
    /**
     * Get an adapter for the specified origin.
     * Adapters are cached after first creation.
     */
    static getAdapter(origin) {
        // Return cached adapter if exists
        if (this.adapters.has(origin)) {
            return this.adapters.get(origin);
        }
        // Create new adapter based on origin
        let adapter;
        switch (origin.toLowerCase()) {
            case "google":
                const googleKey = process.env.GEMINI_API_KEY;
                if (!googleKey) {
                    throw new Error("GEMINI_API_KEY not found in environment variables. Add it to .env file.");
                }
                adapter = new GoogleAdapter_1.GoogleAdapter(googleKey);
                break;
            case "groq":
                const groqKey = process.env.GROQ_API_KEY;
                if (!groqKey) {
                    throw new Error("GROQ_API_KEY not found in environment variables. Add it to .env file.");
                }
                adapter = new GroqAdapter_1.GroqAdapter(groqKey);
                break;
            default:
                throw new Error(`Unsupported origin: ${origin}. Supported origins: google, groq`);
        }
        // Cache the adapter
        this.adapters.set(origin, adapter);
        return adapter;
    }
    /**
     * Get adapter for a specific model by checking which adapter supports it.
     */
    static getAdapterForModel(modelName) {
        // Try to find an adapter that supports this model
        for (const adapter of this.adapters.values()) {
            if (adapter.supportsModel(modelName)) {
                return adapter;
            }
        }
        // Try creating adapters to check support
        const origins = ["google", "groq"];
        for (const origin of origins) {
            try {
                const adapter = this.getAdapter(origin);
                if (adapter.supportsModel(modelName)) {
                    return adapter;
                }
            }
            catch (error) {
                // Skip if API key not available
                continue;
            }
        }
        return null;
    }
    /**
     * Clear all cached adapters.
     */
    static clearCache() {
        this.adapters.clear();
    }
    /**
     * Get list of available origins based on configured API keys.
     */
    static getAvailableOrigins() {
        const origins = [];
        if (process.env.GEMINI_API_KEY) {
            origins.push("google");
        }
        if (process.env.GROQ_API_KEY) {
            origins.push("groq");
        }
        return origins;
    }
}
exports.AdapterFactory = AdapterFactory;
AdapterFactory.adapters = new Map();
