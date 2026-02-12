/**
 * Abstract interface for AI model adapters.
 * Implement this interface to add support for different AI providers.
 */
export interface GenerateContentParams {
  model: string;
  prompt: string;
  temperature?: number;
  maxTokens?: number;
}

export interface GenerateContentResponse {
  text: string;
  tokensUsed?: number;
}

export abstract class AIAdapter {
  protected apiKey: string;

  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error(`API key is required for ${this.constructor.name}`);
    }
    this.apiKey = apiKey;
  }

  /**
   * Generate content using the specified model.
   */
  abstract generateContent(
    params: GenerateContentParams
  ): Promise<GenerateContentResponse>;

  /**
   * Get the origin/provider name for this adapter.
   */
  abstract getOrigin(): string;

  /**
   * Check if this adapter supports a given model name.
   */
  abstract supportsModel(modelName: string): boolean;
}
