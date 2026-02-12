import { GoogleGenAI } from "@google/genai";
import {
  AIAdapter,
  GenerateContentParams,
  GenerateContentResponse,
} from "./AIAdapter";

export class GoogleAdapter extends AIAdapter {
  private client: GoogleGenAI;

  constructor(apiKey: string) {
    super(apiKey);
    this.client = new GoogleGenAI({ apiKey });
  }

  async generateContent(
    params: GenerateContentParams
  ): Promise<GenerateContentResponse> {
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
    } catch (error: any) {
      throw new Error(`Google AI API error: ${error.message}`);
    }
  }

  getOrigin(): string {
    return "google";
  }

  supportsModel(modelName: string): boolean {
    // Google models typically start with "gemini" or "gemma"
    return (
      modelName.startsWith("gemini") ||
      modelName.startsWith("gemma") ||
      modelName.startsWith("models/")
    );
  }
}
