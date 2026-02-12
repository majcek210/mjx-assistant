# MajcekAssistant

An intelligent Discord bot with multi-provider AI model management, automatic rate limiting, and smart model selection.

## Features

- **Multi-Provider Support**: Google Gemini, Groq LLaMA/Mixtral, and extensible to add more
- **Intelligent Model Selection**: Main AI agent analyzes tasks and selects optimal models
- **Advanced Rate Limiting**: Sliding window tracking for RPM, TPM, RPD, TPD
- **Failure Tracking**: Learns from failures to avoid unreliable models
- **Automatic Fallback**: Seamlessly switches to backup models when needed
- **Configurable**: Main agent and strategies configurable via .env

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure API Keys

Copy the example environment file:

```bash
cp .env.example .env
```

Edit `.env` and add your API key(s):

```bash
# Required: At least one provider
GEMINI_API_KEY=your_google_api_key_here
GROQ_API_KEY=your_groq_api_key_here  # Optional

# Configure which model acts as the main agent
MAIN_AGENT_MODEL=google:gemini-1.5-flash
```

**Get API Keys:**
- Google Gemini: https://aistudio.google.com/app/apikey
- Groq (optional): https://console.groq.com/keys

### 3. Optional: Install Groq SDK

If you want to use Groq models:

```bash
npm install groq-sdk
```

### 4. Run

```bash
# Development mode with ts-node
npm run dev

# Or build and run
npm run build
node dist/main.js
```

## How It Works

1. **Model Configuration**: Models are defined in JSON files (`src/lib/ai/models/*.json`)
2. **Main Agent**: Analyzes incoming tasks and selects the best model
3. **Execution**: Selected model executes the task
4. **Tracking**: Usage and outcomes are logged for future decisions
5. **Fallback**: If a model fails, automatically tries the next best option

## Architecture

```
User Task
    ↓
Main Agent (configurable AI model)
    ├─ Analyzes complexity
    ├─ Checks model availability
    ├─ Reviews failure rates
    └─ Selects optimal model
    ↓
Task Executor
    ├─ Executes with selected model
    ├─ Logs usage (RPM/TPM/RPD/TPD)
    ├─ Records outcome (success/failure)
    └─ Auto-fallback on error
    ↓
Result
```

## Adding New AI Providers

The system uses an adapter pattern. To add a new provider:

1. Create adapter class in `src/lib/ai/adapters/`
2. Register it in `AdapterFactory.ts`
3. Add models JSON in `src/lib/ai/models/`
4. Set API key in `.env`

See `CLAUDE.md` for detailed instructions.

## Project Structure

```
src/
├── main.ts                      # Entry point
├── lib/
│   └── ai/
│       ├── handler.ts          # Model lifecycle management
│       ├── storage.ts          # SQLite database with rate limiting
│       ├── mainAgent.ts        # Task analyzer and model selector
│       ├── taskExecutor.ts    # Task execution engine
│       ├── config.json         # Main agent configuration
│       ├── adapters/           # Multi-provider adapters
│       │   ├── AIAdapter.ts    # Base adapter interface
│       │   ├── GoogleAdapter.ts
│       │   ├── GroqAdapter.ts
│       │   └── AdapterFactory.ts
│       └── models/             # Model configurations
│           ├── google.json     # Google Gemini/Gemma models
│           └── groq.json       # Groq LLaMA/Mixtral models
```

## Configuration

### Main Agent (.env)

```bash
# Format: origin:model
MAIN_AGENT_MODEL=google:gemini-1.5-flash
```

### Selection Strategy (config.json)

```json
{
  "selectionStrategy": {
    "failureRateThreshold": 20,      // Filter models with >20% failure rate
    "preferLowerRank": true,          // Prefer rank 1 over rank 2
    "minTokenBuffer": 100,            // Extra token buffer for safety
    "fallbackEnabled": true           // Enable automatic fallback
  }
}
```

## Development

```bash
npm run build    # Compile TypeScript
npm run dev      # Run with ts-node (development)
```

## License

ISC
