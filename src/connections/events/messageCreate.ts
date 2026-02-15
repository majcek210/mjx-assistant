import { Events, EmbedBuilder } from "discord.js";
import { AiHandler } from "../../lib/ai/handler";

const TRIGGER_KEYWORDS = ["remind", "task", "help", "hi", "hello"];

const AIAgent = new AiHandler();

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
    const hasKeyword = TRIGGER_KEYWORDS.some((keyword) =>
      userMessage.toLowerCase().includes(keyword),
    );

    if (isBotMentioned || hasKeyword) {
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

        // Create embedded response
        const embed = new EmbedBuilder()
          .setColor(0x57F287)
          .setTitle("Response")
          .addFields(
            {
              name: "Summary",
              value: response?.response || "No response generated",
              inline: false,
            },
            {
              name: "AI Details",
              value: aiDetails,
              inline: false,
            }
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
