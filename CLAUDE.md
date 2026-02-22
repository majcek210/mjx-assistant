# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Goal

A Discord bot that consults a configurable main AI agent to analyze tasks and delegate them to the best available worker model. Selection considers: RPM/RPD/TPM/TPD limits, model rank (per origin), task complexity, and historical failure rate (stored in DB). Each model has a failure log that informs model selection.

## Project Overview

MajcekAssistant is a Discord bot with intelligent multi-provider AI model management, sliding-window rate limiting, per-channel session memory, and a pluggable storage adapter (SQLite / MySQL / MariaDB).

## Development Commands

```bash
npm run build   # TypeScript → dist/
npm run dev     # ts-node (development)
npm start       # Run compiled output
```

No formal test suite. `AiHandler.test()` covers basic smoke tests.

## Key Environment Variables

```bash
# AI Providers (at least one required)
GEMINI_API_KEY=...
GROQ_API_KEY=...

# Discord
BOT_TOKEN=...
MASTER_ID=...          # Owner-only: bot only responds to this Discord user ID

# Main agent override (optional)
MAIN_AGENT_MODEL=groq:llama-3.3-70b-versatile   # format: origin:model

# Storage (optional — defaults to SQLite)
DB_DRIVER=sqlite       # sqlite | mysql | mariadb
DB_PATH=src/lib/ai/db.sqlite   # SQLite only
DB_HOST=localhost      # MySQL/MariaDB
DB_PORT=3306
DB_USER=
DB_PASS=
DB_NAME=mjxassistant
```

## Configuration: `config.json` (project root)

Single unified config file. Environment variables take priority over values here.

```jsonc
{
  "storage": {
    "driver": "sqlite",            // "sqlite" | "mysql" | "mariadb"
    "sqlite": { "path": "src/lib/ai/db.sqlite" },
    "mysql": { "host": "localhost", "port": 3306, "user": "", "password": "", "database": "mjxassistant" }
  },
  "mainAgent": {
    "model": "groq/compound",
    "origin": "groq",
    "temperature": 0.7,
    "systemPrompt": "...",   // Instructions for the model-selector agent
    "agentPrompt": "..."     // System prompt injected into every worker call
  },
  "selectionStrategy": {
    "failureRateThreshold": 20,   // % — models above this are filtered out
    "preferLowerRank": true,
    "minTokenBuffer": 100,
    "fallbackEnabled": true
  }
}
```

The old `src/lib/ai/config.json` is **deleted** — do not recreate it.

## Architecture

### Entry Point

**`src/main.ts`** — loads `.env`, starts Discord bot via `src/lib/bot/main.ts`.

### Discord Layer

**`src/lib/bot/main.ts`** — `mjx-client` Discord client, routes events from `dist/connections/events`.

**`src/connections/events/messageCreate.ts`** — core message handler:
1. Owner-only gate (`MASTER_ID`)
2. Resolves conversation context (session memory → reply chain fallback)
3. Adds user message to session memory
4. Calls `AIAgent.ask(task, type, context)`
5. Parses JSON response, executes tools, sends refined summary back to AI
6. Stores bot response in session memory
7. Replies with rich embed (summary, AI details, tools)

### Contextual Memory (two layers)

**`src/lib/sessionMemory.ts`** — primary context source.
- `sessionMemory.add(channelId, role, content)` — append a turn
- `sessionMemory.format(channelId)` — return formatted `Previous conversation:` prefix (empty if no/expired session)
- Limits: 10 turns per channel, 1-hour TTL, 500 chars per entry
- Singleton exported as `sessionMemory`

**`src/lib/contextMemory.ts`** — fallback, Discord reply-chain walker.
- Used only when `sessionMemory.format()` returns empty (fresh session or TTL expired)
- `buildContext(message, botId)` — walks `message.reference` up to 5 hops
- Rules: bot messages always included; user messages included only if they @-mentioned the bot; chain breaks on unrelated messages; 30-min max age

Context resolution in `messageCreate.ts`:
```
sessionMemory.format(channelId)  →  non-empty? use it
                                 →  empty? fall back to buildContext()
```

Context injection in `taskExecutor.ts`:
- Context goes to the **worker model only** (`taskWithInstructions`)
- The **main agent (selector) never sees context** — saves selector tokens

### AI Layer

**`src/configs/AIAgent.ts`** — `AiHandler` singleton; calls `seed()` on import (upsert-safe).

**`src/lib/ai/handler.ts`** — `AiHandler`:
- `seed()` — loads JSONs from `src/lib/ai/models/`, upserts to DB
- `ask(task, type, context?)` — delegates to `TaskExecutor`

**`src/lib/ai/taskExecutor.ts`** — `TaskExecutor`:
- `executeTask(task, taskType, context?)` — full workflow
- Caches formatted tool list (`cachedToolsStr`) — built once per process
- Main agent gets just `userTask`; worker gets `agentPrompt + tools + context + task`
- Automatic fallback (up to 3 models) on failure

**`src/lib/ai/mainAgent.ts`** — `MainAgent`:
- Loads config from root `config.json`
- Reads `selectionStrategy.failureRateThreshold` (was broken before — now fixed)
- Pre-fetches failure rates in parallel (`Promise.all`) to avoid async inside `.filter()`
- `selectModelForTask(task)` → `TaskAnalysis`
- `updateMainAgent(model, origin)` — runtime switch

**`src/lib/ai/adapters/`** — multi-provider:
- `AIAdapter.ts` — abstract base
- `GoogleAdapter.ts` — `@google/genai`
- `GroqAdapter.ts` — `groq-sdk`
- `AdapterFactory.ts` — caches instances per origin

### Storage Adapter Layer

**`src/lib/ai/storage/IStorage.ts`** — async interface (all methods return `Promise`).

**`src/lib/ai/storage/SQLiteStorage.ts`** — implements `IStorage` using `better-sqlite3` (sync internally, wrapped in async).

**`src/lib/ai/storage/MySQLStorage.ts`** — implements `IStorage` using `mysql2/promise`. Requires: `npm install mysql2`. Works with both MySQL 8+ and MariaDB 10.5+.

**`src/lib/ai/storage/StorageFactory.ts`** — `StorageFactory.create()` reads `DB_DRIVER` env var (or `config.json`) and returns the right adapter.

**`src/lib/ai/storage.ts`** — re-export shim for backwards compatibility (exports `ModelStore` = `SQLiteStorage`).

### Tool System

**`src/lib/ai/toolExecutor.ts`** — dynamic tool loader; `executeTool(name, args)`, `listTools()`.

**`src/configs/toolExecutor.ts`** — singleton, auto-initializes.

**`src/lib/reponseParser.ts`** — parses AI JSON into `{ content, reasoning, tools }`.

## Model Configuration (`src/lib/ai/models/*.json`)

```json
{
  "origin": "provider-name",
  "models": [
    { "rank": 1, "name": "model-name", "description": "...", "limits": { "rpm": 5, "tpm": 250000, "rpd": 20 } }
  ]
}
```

Lower `rank` = higher priority. Ranks are per-origin.

## Database Schema

Three tables: `models`, `usage_logs`, `task_logs`.

Sliding window rate limiting:

| Limit | Window |
|-------|--------|
| RPM/TPM | last 60 s |
| RPD/TPD | last 24 h |

Logs auto-expire: usage_logs after 24h, task_logs after 7 days.

## Adding a New AI Provider

1. Create `src/lib/ai/adapters/{Provider}Adapter.ts` extending `AIAdapter`
2. Register in `AdapterFactory.ts`
3. Create `src/lib/ai/models/provider.json`
4. Add `PROVIDER_API_KEY` to `.env`

## Adding a New Storage Driver

1. Create `src/lib/ai/storage/{Driver}Storage.ts` implementing `IStorage`
2. Register in `StorageFactory.ts` (`case "driver":`)
3. Add connection config to `config.json` and env var docs

## Key Implementation Details

- TypeScript, strict mode, CommonJS (`"type": "commonjs"`)
- All DB queries use prepared statements (SQL injection safe)
- Bot messages in Discord are stored as embeds — `contextMemory` extracts from `embed.data.description ?? embed.description`
- `selectionStrategy.failureRateThreshold` was previously missing from config, causing emergency-fallback-only mode — now fixed in `config.json`
- `mysql2` is an optional runtime dependency — only required when `DB_DRIVER=mysql` or `mariadb`
