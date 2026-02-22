/**
 * Contextual Memory — Discord reply-chain walker.
 *
 * Rules (strictly enforced):
 * 1. User replies to a bot message → walk chain, collect bot+user turns.
 * 2. User replies to another user but tags the bot → include that user's message as
 *    the "referenced content" (first hop only), then stop walking.
 * 3. User replies to any non-bot message on the FIRST HOP → always include it
 *    (the user is explicitly asking the bot to look at it), then stop.
 * 4. Chain stops after the first non-bot/non-tagged-bot message on deeper hops.
 * 5. Messages older than MAX_CHAIN_AGE_MS are ignored.
 * 6. Each entry truncated to MAX_MESSAGE_CHARS.
 */

const MAX_CHAIN_DEPTH = 5;
const MAX_MESSAGE_CHARS = 500;
const MAX_CHAIN_AGE_MS = 30 * 60 * 1000; // 30 minutes

export interface ContextEntry {
  role: "user" | "bot";
  content: string;
}

export interface ConversationContext {
  chain: ContextEntry[];
  hasContext: boolean;
}

function extractContent(msg: any, botId: string): string {
  if (msg.author.id === botId && msg.embeds?.length > 0) {
    const embed = msg.embeds[0];
    const desc = embed?.data?.description ?? embed?.description ?? "";
    if (desc) return desc.slice(0, MAX_MESSAGE_CHARS);
  }

  return (msg.content ?? "")
    .replace(new RegExp(`<@!?${botId}>\\s*`, "g"), "")
    .trim()
    .slice(0, MAX_MESSAGE_CHARS);
}

/**
 * Build a scoped conversation context chain from a Discord message's reply tree.
 *
 * Key fix: on the FIRST hop, if the referenced message has no bot involvement,
 * we still include it (the user is asking the bot to process/reference it) but
 * we do NOT continue walking further up the chain from there.
 */
export async function buildContext(
  message: any,
  botId: string
): Promise<ConversationContext> {
  if (!message.reference?.messageId) {
    return { chain: [], hasContext: false };
  }

  const chain: ContextEntry[] = [];
  let currentRef: { messageId?: string } | null = message.reference;
  let depth = 0;
  let firstHop = true;

  while (currentRef?.messageId && depth < MAX_CHAIN_DEPTH) {
    let refMsg: any;
    try {
      refMsg = await message.channel.messages.fetch(currentRef.messageId);
    } catch {
      break;
    }

    if (Date.now() - refMsg.createdTimestamp > MAX_CHAIN_AGE_MS) break;

    const isFromBot = refMsg.author.id === botId;
    const taggedBot = refMsg.mentions?.has?.(botId) ?? false;

    if (isFromBot) {
      // Bot reply → always relevant, continue walking
      const content = extractContent(refMsg, botId);
      if (content) chain.unshift({ role: "bot", content });
      currentRef = refMsg.reference ?? null;
    } else if (taggedBot) {
      // User message that tagged the bot → include, continue walking
      const content = extractContent(refMsg, botId);
      if (content) chain.unshift({ role: "user", content });
      currentRef = refMsg.reference ?? null;
    } else if (firstHop) {
      // First hop to a plain user↔user message.
      // The current user is replying to it AND tagging the bot → include it as
      // the "thing being referenced", but stop chain here (it's not bot history).
      const content = extractContent(refMsg, botId);
      if (content) chain.unshift({ role: "user", content });
      break; // don't walk further from a non-bot message
    } else {
      // Deeper hop with no bot involvement → chain breaks
      break;
    }

    firstHop = false;
    depth++;
  }

  return { chain, hasContext: chain.length > 0 };
}

/**
 * Format a chain as a "Previous conversation:" prefix.
 * Returns empty string when there is no context.
 */
export function formatContext(chain: ContextEntry[]): string {
  if (chain.length === 0) return "";

  const lines = chain
    .map((e) => `[${e.role === "bot" ? "Assistant" : "User"}]: ${e.content}`)
    .join("\n");

  return `Previous conversation:\n${lines}\n\n`;
}

/**
 * Format a single referenced message as a distinct block.
 * Used when the chain is a single first-hop user↔user message.
 */
export function formatReferencedMessage(chain: ContextEntry[]): string {
  if (chain.length === 0) return "";

  // If there's only one entry and it's a user message (first-hop reference),
  // label it specifically so the AI understands what it's being asked to look at.
  if (chain.length === 1 && chain[0].role === "user") {
    return `Referenced message: ${chain[0].content}\n\n`;
  }

  return formatContext(chain);
}
