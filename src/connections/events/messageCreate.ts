import { Events, EmbedBuilder } from "discord.js";
import AIAgent from "../../configs/AIAgent";
import parse from "../../lib/reponseParser";
import ToolExecutor from "../../configs/toolExecutor"



export default {
  name: Events.MessageCreate,
  async execute(message: any) {
    if (message.author.bot) return;

    // Only respond to the master/owner
    const masterId = process.env.MASTER_ID;
    if (!masterId || message.author.id !== masterId) return;

    const botId = message.client.user.id;
    const userMessage = message.content
      .replace(new RegExp(`<@!?${botId}>\\s*`), "")
      .trim();

    if (!userMessage) return;

    // Check if message is directed at bot or contains trigger keywords
    const isBotMentioned = message.mentions.has(botId);


    if (isBotMentioned) {
      try {
        await message.channel.sendTyping();

        const response = await AIAgent.ask(userMessage, "general");
        console.log(response);

        // Helper function to format numbers with k/m abbreviations
        // Shows full number if capacity is less than 1%
        const formatLimit = (used: number, limit: number): string => {
          const remaining = limit - used;
          const percentageLeft = (remaining / limit) * 100;

          // Show full number if less than 1% capacity remaining
          if (percentageLeft < 1) {
            return `${used.toLocaleString()}/${limit.toLocaleString()}`;
          }

          // Format with abbreviations
          const formatNum = (n: number): string => {
            if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "m";
            if (n >= 1_000) return (n / 1_000).toFixed(0) + "k";
            return n.toString();
          };

          return `${formatNum(used)}/${formatNum(limit)}`;
        };

        // Build AI Details text with bullet points
        let aiDetails = `• **Model:** \`${response?.modelUsed || "Unknown"}\`\n`;
        aiDetails += `• **Tokens Used:** \`${(response?.tokensUsed || 0).toLocaleString()}\`\n`;

        if (response?.limits) {
          const rpm = response.limits.rpm;
          const tpm = response.limits.tpm;
          const rpd = response.limits.rpd;
          const tpd = response.limits.tpd;

          // Format model limits line with smart number formatting
          aiDetails += `• **Model Limits:** RPM: \`${formatLimit(rpm.used, rpm.limit)}\`, TPM: \`${formatLimit(tpm.used, tpm.limit)}\`, RPD: \`${formatLimit(rpd.used, rpd.limit)}\`, TPD: \`${formatLimit(tpd.used, tpd.limit)}\``;
        }

        const { content, tools } = parse(response?.response);

        console.log(tools);

        // Initialize and execute tools
        let toolResults: Array<{ name: string; success: boolean; result?: any; error?: string }> = [];

        if (tools.length > 0) {
          try {

            for (const tool of tools) {
              try {
                const result = await ToolExecutor.executeTool(tool.name, tool.arguments || {});
                toolResults.push({
                  name: tool.name,
                  success: result.success,
                  result: result.success ? result.result : undefined,
                  error: !result.success ? result.error : undefined,
                });
              } catch (error) {
                toolResults.push({
                  name: tool.name,
                  success: false,
                  error: error instanceof Error ? error.message : "Unknown error",
                });
              }
            }
          } catch (error) {
            console.error("Failed to initialize tool executor:", error);
          }
        }

        const toolList =
          tools.length > 0
            ? tools.map((t: any) => `• ${t.name}`).join("\n")
            : "None";

        // Format tool results for display
        let toolResultsText = "None";
        let finalContent = content;

        if (toolResults.length > 0) {
          toolResultsText = toolResults
            .map((tr) => {
              if (tr.success) {
                return `✅ **${tr.name}:** ${JSON.stringify(tr.result).substring(0, 100)}`;
              } else {
                return `❌ **${tr.name}:** ${tr.error}`;
              }
            })
            .join("\n");

          // Pass tool results back to AI for analysis
          console.log("📤 Sending tool results back to AI for analysis...");
          const toolResultsContext = toolResults
            .map((tr) => {
              if (tr.success) {
                return `Tool: ${tr.name}\nResult: ${JSON.stringify(tr.result)}`;
              } else {
                return `Tool: ${tr.name}\nError: ${tr.error}`;
              }
            })
            .join("\n\n");

          const refinedPrompt = `Original user request: "${userMessage}"\n\nI executed the following tools:\n\n${toolResultsContext}\n\nNow analyze these tool results and provide a clear, concise summary for the user.`;

          try {
            const refinedResponse = await AIAgent.ask(refinedPrompt, "analysis");
            const { content: refinedContent } = parse(refinedResponse?.response);
            finalContent = refinedContent || content;
            console.log("✅ AI analysis complete");
          } catch (error) {
            console.error("Failed to get AI analysis of tool results:", error);
            // Keep original content if AI analysis fails
          }
        }

        const embed = new EmbedBuilder()
          .setColor(0x57f287)
          .setTitle("Response")
          .addFields(
            {
              name: "Summary",
              value: finalContent || "No response generated",
              inline: false,
            },
            {
              name: "AI Details",
              value: aiDetails,
              inline: false,
            },
            {
              name: "Tools Used",
              value: toolList,
              inline: false,
            },
            {
              name: "Tool Results",
              value: toolResultsText,
              inline: false,
            },
          )
          .setFooter({ text: `Requested by ${message.author.username}` })
          .setTimestamp();

        await message.reply({
          embeds: [embed],
          allowedMentions: { repliedUser: false },
        });
      } catch (error) {
        console.error("Error in messageCreate event:", error);
        await message
          .reply({
            content: "❌ An error occurred processing your request.",
            allowedMentions: { repliedUser: false },
          })
          .catch(console.error);
      }
    }
  },
};
