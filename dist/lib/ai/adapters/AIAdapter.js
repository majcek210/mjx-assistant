"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AIAdapter = void 0;
class AIAdapter {
    constructor(apiKey) {
        if (!apiKey) {
            throw new Error(`API key is required for ${this.constructor.name}`);
        }
        this.apiKey = apiKey;
    }
}
exports.AIAdapter = AIAdapter;
