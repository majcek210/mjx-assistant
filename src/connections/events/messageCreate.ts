import { Events, EmbedBuilder } from "discord.js";
import { AiHandler } from "../../lib/ai/handler"

const TRIGGER_KEYWORDS = ["remind", "task", "help", "hi", "hello"];

const AIAgent = new AiHandler()

export default {
    name: Events.MessageCreate,
    async execute(message: any) {
        if (message.author.bot) return;

        // Only respond to the master/owner
        const masterId = process.env.MASTER_ID;
        if (!masterId || message.author.id !== masterId) return;

        const botId = message.client.user.id;
        const userMessage = message.content.replace(new RegExp(`<@!?${botId}>\\s*`), '').trim();

        if (!userMessage) return;

        // Check if message is directed at bot or contains trigger keywords
        const isBotMentioned = message.mentions.has(botId);
        const hasKeyword = TRIGGER_KEYWORDS.some(keyword => 
            userMessage.toLowerCase().includes(keyword)
        );

        if (isBotMentioned || hasKeyword) {
            try {
                await message.channel.sendTyping();
                
                const response = await AIAgent.ask(userMessage, "general")

                // Create embedded response
                const embed = new EmbedBuilder()
                    .setColor(0x0099ff)
                    .setTitle("Assistant Response")
                    .setDescription(response?.response || "No response generated")
                    .addFields(
                        { name: "Model", value: response?.modelUsed || "unknown", inline: true },
                        { name: "Tokens Used", value: (response?.tokensUsed || 42).toString(), inline: true },
                       
                    )
                    .setFooter({ text: `Requested by ${message.author.username}` })
                    .setTimestamp();

                await message.reply({ embeds: [embed], allowedMentions: { repliedUser: false } });
            } catch (error) {
                console.error("Error in messageCreate event:", error);
                await message.reply({
                    content: "❌ An error occurred processing your request.",
                    allowedMentions: { repliedUser: false }
                }).catch(console.error);
            }
        }
    },
};
