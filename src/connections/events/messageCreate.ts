import { Events, EmbedBuilder } from "discord.js";
import AIAgent from "../../services/AIAgent";
import parse from "../../lib/responseParser";
import ToolExecutor from "../../services/toolExecutor";
import { buildContext, formatContext, formatReferencedMessage } from "../../lib/context/contextMemory";
import { sessionMemory } from "../../lib/context/sessionMemory";
import { setClient } from "../../lib/bot/discordClient";

export default {
  name: Events.MessageCreate,
  async execute(message: any) {
    if (message.author.bot) return;

    // Owner-only
    const masterId = process.env.MASTER_ID;
    if (!masterId || message.author.id !== masterId) return;

    // Register the Discord client for reminder delivery
    setClient(message.client);

    const botId = message.client.user.id;
    const userMessage = message.content
      .replace(new RegExp(`<@!?${botId}>\\s*`), "")
      .trim();

    if (!userMessage) return;

    const isBotMentioned = message.mentions.has(botId);

    if (isBotMentioned) {
      try {
        await message.channel.sendTyping();
        const channelId: string = message.channel.id;
        const userId: string = message.author.id;

        // ── Context resolution ─────────────────────────────────────────────
        // Session memory = ongoing conversation history for this channel.
        // Reply chain  = the specific message(s) being pointed at right now.
        //
        // Both are ALWAYS checked and combined:
        //   - Session memory provides historical turns (even on fresh @mention)
        //   - Reply chain provides the immediate referenced content
        //     (works for user→bot replies AND user→user replies where bot is tagged)
        const sessionContext = sessionMemory.format(channelId);

        let referencedContext = "";
        if (message.reference?.messageId) {
          const { chain } = await buildContext(message, botId);

          // If only one entry and it's a first-hop plain user message,
          // label it distinctly so the AI knows it's the referenced content.
          referencedContext = chain.length === 1 && chain[0].role === "user"
            ? formatReferencedMessage(chain)
            : formatContext(chain);
        }

        const context = sessionContext + referencedContext;

        // Add current user turn to session memory
        sessionMemory.add(channelId, "user", userMessage);
        // ──────────────────────────────────────────────────────────────────

        const response = await AIAgent.ask(userMessage, "general", context);
        console.log(response);

        // ── Limits formatting ──────────────────────────────────────────────
        const formatLimit = (used: number, limit: number): string => {
          const pct = ((limit - used) / limit) * 100;
          if (pct < 1) return `${used.toLocaleString()}/${limit.toLocaleString()}`;
          const fmt = (n: number) =>
            n >= 1_000_000 ? (n / 1_000_000).toFixed(1) + "m"
              : n >= 1_000 ? (n / 1_000).toFixed(0) + "k"
              : String(n);
          return `${fmt(used)}/${fmt(limit)}`;
        };

        let aiDetails = `• **Model:** \`${response?.modelUsed || "Unknown"}\`\n`;
        aiDetails += `• **Tokens:** \`${(response?.tokensUsed || 0).toLocaleString()}\`\n`;
        if (response?.limits) {
          const { rpm, tpm, rpd, tpd } = response.limits;
          aiDetails += `• **Limits:** RPM: \`${formatLimit(rpm.used, rpm.limit)}\`, TPM: \`${formatLimit(tpm.used, tpm.limit)}\`, RPD: \`${formatLimit(rpd.used, rpd.limit)}\`, TPD: \`${formatLimit(tpd.used, tpd.limit)}\``;
        }

        const { content, tools } = parse(response?.response);

        // ── Tool execution ─────────────────────────────────────────────────
        let toolResults: Array<{ name: string; success: boolean; result?: any; error?: string }> = [];

        if (tools.length > 0) {
          for (const tool of tools) {
            try {
              // Always inject Discord context so tools like Reminder can use it
              const args = {
                ...tool.arguments || {},
                channelId,
                userId,
              };
              const result = await ToolExecutor.executeTool(tool.name, args);
              toolResults.push({
                name: tool.name,
                success: result.success,
                result: result.success ? result.result : undefined,
                error: !result.success ? (result as any).error : undefined,
              });
            } catch (error) {
              toolResults.push({
                name: tool.name,
                success: false,
                error: error instanceof Error ? error.message : "Unknown error",
              });
            }
          }
        }

        const toolList = tools.length > 0
          ? tools.map((t: any) => `• ${t.name}`).join("\n")
          : "None";
        let toolResultsText = "None";
        let finalContent = content;

        if (toolResults.length > 0) {
          toolResultsText = toolResults
            .map((tr) =>
              tr.success
                ? `✅ **${tr.name}:** ${JSON.stringify(tr.result).substring(0, 100)}`
                : `❌ **${tr.name}:** ${tr.error}`
            )
            .join("\n");

          const toolResultsContext = toolResults
            .map((tr) =>
              tr.success
                ? `Tool: ${tr.name}\nResult: ${JSON.stringify(tr.result)}`
                : `Tool: ${tr.name}\nError: ${tr.error}`
            )
            .join("\n\n");

          const refinedPrompt = `Original user request: "${userMessage}"\n\nI executed the following tools:\n\n${toolResultsContext}\n\nNow analyze these tool results and provide a clear, concise summary for the user.`;

          try {
            const refinedResponse = await AIAgent.ask(refinedPrompt, "analysis");
            const { content: refinedContent } = parse(refinedResponse?.response);
            finalContent = refinedContent || content;
          } catch (error) {
            console.error("Failed to get AI analysis of tool results:", error);
          }
        }

        // Store bot response in session memory
        if (finalContent) {
          sessionMemory.add(channelId, "bot", finalContent);
        }
        // ──────────────────────────────────────────────────────────────────

        const embed = new EmbedBuilder()
          .setColor(0x57f287)
          .setTitle("Response")
          .addFields(
            { name: "Summary", value: finalContent || "No response generated", inline: false },
            { name: "AI Details", value: aiDetails, inline: false },
            { name: "Tools Used", value: toolList, inline: false },
            { name: "Tool Results", value: toolResultsText, inline: false },
          )
          .setFooter({ text: `Requested by ${message.author.username}` })
          .setTimestamp();

        await message.reply({ embeds: [embed], allowedMentions: { repliedUser: false } });
      } catch (error) {
        console.error("Error in messageCreate:", error);
        await message
          .reply({ content: "❌ An error occurred processing your request.", allowedMentions: { repliedUser: false } })
          .catch(console.error);
      }
    }
  },
};
