# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# projecct goal
The main system is:
a bot consults a main ai(which will be configurable) the ai analyses the task and decides which ai agent will be used infuenced by limits like reuqests per minute, requestst per day, tokens per day, model description, Model rank(this is diffrent per origin, so there can be multiple 1,2,3,...) and task complexity. Each model should also have failed task in the db that willč help the main agent decide.


## Project Overview

MajcekAssistant is a Discord bot with AI model management capabilities. The project manages multiple AI models (primarily Google Gemini/Gemma variants) with rate limiting, usage tracking, and intelligent model selection based on availability and token requirements.

## Development Commands

### Build and Run
```bash
npm run build        # Compile TypeScript to JavaScript (outputs to dist/)
npm run dev          # Run directly with ts-node (development mode)
```

### Testing
There are no formal tests configured. The `handler.test()` method in `src/lib/ai/handler.ts` provides basic functionality testing.

## Architecture

### Core Components

**`src/main.ts`** - Entry point
- Instantiates `AiHandler`
- Seeds the database with model configurations
- Runs basic tests

**`src/lib/ai/handler.ts`** - AI Model Handler
- Manages AI model lifecycle (seeding, testing)
- Reads model configurations from JSON files in `src/lib/ai/models/`
- Each JSON file should have an `origin` field and a `models` array
- Model objects must include: `name`, `rank`, `description`, and `limits` (rpm, tpm, rpd)
- Integrates `TaskExecutor` for intelligent task execution

**`src/lib/ai/storage.ts`** - Database Layer (SQLite)
- `ModelStore` class manages three tables:
  - `models` - stores model metadata, limits, configuration, and aggregate task counters
  - `usage_logs` - stores timestamped usage events for sliding window tracking
  - `task_logs` - stores individual task outcomes (success/failure) with error messages
- Uses **true sliding window tracking** (queries last 60s for RPM/TPM, last 24h for RPD/TPD)
- Includes database indexes on timestamps for efficient time-window queries
- `logModelUsage(model, requests, tokens)` creates timestamped usage entries
- `logTaskOutcome(model, taskType, success, tokens, error?)` logs task results
- `getModelUsage(model)` calculates current usage by querying logs within time windows
- `getModelFailureRate(model, timeWindow?)` calculates failure rate percentage
- `getRecentFailedTasks(model, limit)` retrieves recent failures for analysis
- `getAllAvailableModels(minTokens)` returns models with available capacity in all limits
- `cleanupOldLogs()` removes usage logs older than 24 hours
- `cleanupOldTaskLogs(days)` removes task logs older than specified days (default: 7)
- `getModelStats()` provides detailed statistics including success/failure counts

**`src/lib/ai/adapters/`** - Multi-Provider Adapter System
- Abstraction layer supporting multiple AI providers
- **`AIAdapter.ts`** - Abstract base class defining the adapter interface
  - `generateContent(params)` - standardized method for all providers
  - `getOrigin()` - returns provider name (google, groq, etc.)
  - `supportsModel(modelName)` - checks if model is supported by this provider
- **`GoogleAdapter.ts`** - Google Gemini/Gemma implementation
  - Uses `@google/genai` SDK
  - Supports gemini-* and gemma-* models
- **`GroqAdapter.ts`** - Groq LLaMA/Mixtral implementation
  - Uses `groq-sdk` (optional dependency)
  - Supports llama-*, mixtral-*, and other Groq models
- **`AdapterFactory.ts`** - Factory for creating and caching adapters
  - `getAdapter(origin)` - gets/creates adapter for a provider
  - `getAdapterForModel(modelName)` - auto-detects provider by model name
  - `getAvailableOrigins()` - lists configured providers based on API keys

**`src/lib/ai/mainAgent.ts`** - Main Agent (Model Selector)
- Configurable AI agent that analyzes tasks and selects optimal models
- **Main agent can be configured via .env** (MAIN_AGENT_MODEL) or config.json
- Format: `origin:model` (e.g., `google:gemini-1.5-flash` or `groq:llama-3.3-70b-versatile`)
- Uses adapter system to work with any configured provider
- Configuration in `src/lib/ai/config.json`:
  - `mainAgent.systemPrompt` - instructions for model selection logic
  - `selectionStrategy` - thresholds and preferences (failure rate, fallback, etc.)
- `selectModelForTask(task)` - analyzes task and returns selected model with reasoning
- Considers: task complexity, token requirements, model availability, failure rates, model rank
- Automatically filters out models with high failure rates (>20% by default)
- Provides fallback selection if main agent fails or selects unavailable model
- `updateMainAgent(model, origin)` - change the main agent model dynamically (runtime only)

**`src/lib/ai/taskExecutor.ts`** - Task Execution Engine
- Orchestrates the complete task execution flow
- `executeTask(task, taskType)` - main entry point for task execution
- Workflow:
  1. Consults main agent to select optimal model
  2. Executes task with selected model
  3. Logs usage and task outcome
  4. Automatic retry with fallback model if first attempt fails
- Integrates with Google AI SDK for actual API calls
- Returns `TaskResult` with success status, response, tokens used, and analysis

### Model Configuration Structure

Model JSON files in `src/lib/ai/models/` follow this schema:
```json
{
  "origin": "provider-name",
  "models": [
    {
      "rank": 1,
      "name": "model-name",
      "category": "text",
      "description": "When to use this model",
      "limits": {
        "rpm": 5,      // requests per minute
        "tpm": 250000, // tokens per minute
        "rpd": 20      // requests per day
      }
    }
  ]
}
```

### Database Schema

The database (`db.sqlite`) persists across runs and uses a log-based architecture:

**`models` table:**
- Stores configuration: `model`, `origin`, `rank`, `description`, `enabled`
- Stores limits: `rpm_allowed`, `tpm_total`, `rpd_total`, `tpd_total`
- Timestamps: `created_at`, `updated_at`

**`usage_logs` table:**
- Individual usage events: `id`, `model`, `requests`, `tokens`, `timestamp`
- Indexed on `timestamp` and `(model, timestamp)` for fast time-window queries
- Entries older than 24 hours are automatically cleaned up

### Sliding Window Tracking

The system implements **true sliding windows** by querying timestamped logs:

1. **RPM (Requests Per Minute)**: Counts requests with `timestamp >= now - 60`
2. **TPM (Tokens Per Minute)**: Sums tokens with `timestamp >= now - 60`
3. **RPD (Requests Per Day)**: Counts requests with `timestamp >= now - 86400`
4. **TPD (Tokens Per Day)**: Sums tokens with `timestamp >= now - 86400`

This approach provides accurate rate limiting without manual reset logic. Usage naturally "ages out" as time passes.

### Model Selection Logic

Models are ranked by preference (rank field, lower = higher priority). `getAllAvailableModels(minTokens)` filters by:
- Enabled status (`enabled = 1`)
- Available RPM capacity: `rpm_allowed - rpm_used >= 1`
- Available TPM capacity: `tpm_total - tpm_used >= minTokens`
- Available RPD capacity: `rpd_total - rpd_used >= 1`
- Available TPD capacity: `tpd_total - tpd_used >= minTokens`

Returns models sorted by rank, allowing the system to always select the best available model.

## Storage API Usage

### Logging Usage
```typescript
storage.logModelUsage("model-name", requests, tokens);
// Example: storage.logModelUsage("gemini-3-flash", 1, 500);
```

### Checking Current Usage
```typescript
const usage = storage.getModelUsage("model-name");
// Returns: { model, rpmUsed, tpmUsed, rpdUsed, tpdUsed }
```

### Getting Available Models
```typescript
const available = storage.getAllAvailableModels(minTokens);
// Returns array of models sorted by rank with available capacity
```

### Database Maintenance
```typescript
storage.cleanupOldLogs(); // Remove logs older than 24 hours
```

## Key Implementation Details

- TypeScript with strict mode enabled
- CommonJS module system (not ES modules)
- Better-sqlite3 for synchronous database operations
- Discord.js v14 is a dependency but not yet integrated in the current codebase
- The project uses a rank-based model selection strategy where lower rank = higher priority
- All database queries use prepared statements for safety and performance
- Indexes on timestamps ensure efficient time-window queries even with large log volumes

## Environment Setup

Required environment variables in `.env` (gitignored, see `.env.example`):
```bash
GOOGLE_API_KEY=your_google_api_key_here  # Required for AI operations
DISCORD_BOT_TOKEN=your_token_here         # Required when Discord is integrated
```

Get API keys:
- Google AI: https://aistudio.google.com/app/apikey
- Groq: https://console.groq.com/keys

## Multi-Provider Support

### Supported Providers

The system currently supports:

1. **Google (Gemini/Gemma)**
   - Requires: `GEMINI_API_KEY` in .env
   - Models configured in: `src/lib/ai/models/google.json`
   - Examples: `gemini-2.0-flash-exp`, `gemini-1.5-flash`, `gemini-1.5-pro`

2. **Groq (LLaMA/Mixtral)**
   - Requires: `GROQ_API_KEY` in .env
   - Install: `npm install groq-sdk`
   - Models configured in: `src/lib/ai/models/groq.json`
   - Examples: `llama-3.3-70b-versatile`, `llama-3.1-8b-instant`, `mixtral-8x7b-32768`

### Adding a New Provider

To add support for a new AI provider (e.g., OpenAI, Anthropic, Cohere):

1. **Create adapter class** in `src/lib/ai/adapters/{Provider}Adapter.ts`:
```typescript
import { AIAdapter, GenerateContentParams, GenerateContentResponse } from "./AIAdapter";

export class OpenAIAdapter extends AIAdapter {
  private client: OpenAI;

  constructor(apiKey: string) {
    super(apiKey);
    this.client = new OpenAI({ apiKey });
  }

  async generateContent(params: GenerateContentParams): Promise<GenerateContentResponse> {
    const completion = await this.client.chat.completions.create({
      model: params.model,
      messages: [{ role: "user", content: params.prompt }],
      temperature: params.temperature,
    });

    return {
      text: completion.choices[0].message.content || "",
      tokensUsed: completion.usage?.total_tokens,
    };
  }

  getOrigin(): string {
    return "openai";
  }

  supportsModel(modelName: string): boolean {
    return modelName.startsWith("gpt-");
  }
}
```

2. **Register in AdapterFactory** (`src/lib/ai/adapters/AdapterFactory.ts`):
```typescript
case "openai":
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) {
    throw new Error("OPENAI_API_KEY not found in environment variables");
  }
  adapter = new OpenAIAdapter(openaiKey);
  break;
```

3. **Create models configuration** in `src/lib/ai/models/openai.json`:
```json
{
  "origin": "openai",
  "models": [
    {
      "rank": 1,
      "name": "gpt-4-turbo",
      "category": "text",
      "description": "Most capable GPT-4 model...",
      "limits": {
        "rpm": 500,
        "tpm": 150000,
        "rpd": 10000
      }
    }
  ]
}
```

4. **Add API key** to `.env`:
```
OPENAI_API_KEY=your_key_here
```

The system will automatically detect and use the new provider!

## Using the Agent Selection System

### Basic Usage

```typescript
import { AiHandler } from "./lib/ai/handler";

const handler = new AiHandler();

// Seed models from JSON files
handler.seed();

// Execute a task with intelligent model selection
const result = await handler.executor.executeTask(
  "What is the capital of France?",
  "geography"
);

if (result.success) {
  console.log(`Model used: ${result.modelUsed}`);
  console.log(`Response: ${result.response}`);
  console.log(`Tokens: ${result.tokensUsed}`);
}
```

### Configuring the Main Agent

**Via .env (recommended):**
```bash
# Set which model analyzes tasks and selects other models
MAIN_AGENT_MODEL=google:gemini-1.5-flash
# Or use Groq:
# MAIN_AGENT_MODEL=groq:llama-3.3-70b-versatile
```

**Via config.json (fallback):**
Edit `src/lib/ai/config.json`:
```json
{
  "mainAgent": {
    "model": "gemini-1.5-flash",
    "origin": "google",
    "temperature": 0.7,
    "systemPrompt": "..."
  }
}
```

**Programmatically (runtime only):**
```typescript
handler.executor.getMainAgent().updateMainAgent("gemini-1.5-pro", "google");
```

### How Selection Works

1. **Main Agent Analysis**: The configured main agent (e.g., gemini-2.5-flash) receives:
   - User task description
   - Available models with their stats (limits, usage, failure rates, descriptions)
   - Instructions to analyze complexity and select optimal model

2. **Decision Factors**:
   - Task complexity (simple/moderate/complex)
   - Token requirements (estimated by main agent)
   - Model availability (RPM, TPM, RPD, TPD limits)
   - Model reliability (recent failure rate < 20%)
   - Model rank (lower number = higher priority within origin)
   - Model descriptions (when to use each model)

3. **Execution**: Selected model executes the task with automatic:
   - Usage logging (RPM/TPM/RPD/TPD tracking)
   - Task outcome logging (success/failure with errors)
   - Fallback to next best model if first attempt fails

### Example Decision Flow

```
User Task: "Explain quantum computing in detail"
↓
Main Agent (gemini-2.5-flash) analyzes:
  - Complexity: complex
  - Estimated tokens: 800
  - Available models: gemini-3-flash, gemini-2.5-flash, gemma-3-27B
  - gemini-3-flash: rank 1, highest quality, 4/5 RPM used
  - gemini-2.5-flash: rank 2, good quality, 0/5 RPM used
  - gemma-3-27B: rank 4, open model, 0/30 RPM used
↓
Decision: gemini-2.5-flash
Reasoning: "Complex task requiring strong reasoning. Gemini-3-flash near rate limit.
           Gemini-2.5-flash has sufficient capacity and quality for this task."
↓
Execute with gemini-2.5-flash → Log usage & outcome
```

## Important Notes

- Database persists across restarts - usage logs accumulate and are cleaned after 24 hours
- Model configurations are seeded on startup with `ON CONFLICT DO UPDATE` (upserts)
- Discord.js is included in dependencies but not yet used in the codebase
- The `@google/genai` package is installed but not yet integrated into the handler
- Sliding window tracking means no manual reset logic - usage naturally expires as time passes
- The system supports TPD (tokens per day) in addition to TPM for better daily quota management
