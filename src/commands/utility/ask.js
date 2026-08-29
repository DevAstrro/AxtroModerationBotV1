import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { errorEmbed } from '../../utils/embed.js';
import { isAdmin } from '../../utils/permissions.js';
import { UserAskLimitModel } from '../../models/UserAskLimit.js';
import { config } from '../../config.js';
import { logger } from '../../utils/logger.js';

export const defer = true;
export const ephemeral = false;

export const data = new SlashCommandBuilder()
  .setName('ask')
  .setDescription('Ask Questions To AI')
  .addStringOption(option =>
    option.setName('question')
      .setDescription('The question you want to ask')
      .setRequired(true)
  );

export async function execute(interaction, client) {
  const question = interaction.options.getString('question', true);
  const userId = interaction.user.id;

  const isUserAdmin = await isAdmin(interaction);

  if (!isUserAdmin) {
    const now = new Date();
    let limitRecord = await UserAskLimitModel.findOne({ userId });

    if (!limitRecord) {
      limitRecord = new UserAskLimitModel({
        userId,
        count: 1,
        lastUsed: now,
      });
      await limitRecord.save();
    } else {
      const lastUsed = limitRecord.lastUsed;
      const isSameDay = now.getUTCFullYear() === lastUsed.getUTCFullYear() &&
                        now.getUTCMonth() === lastUsed.getUTCMonth() &&
                        now.getUTCDate() === lastUsed.getUTCDate();

      if (!isSameDay) {
        limitRecord.count = 1;
        limitRecord.lastUsed = now;
      } else {
        if (limitRecord.count >= 15) {
          const limitEmbed = errorEmbed('You have reached your daily limit of 15 queries for `/ask`. Limits reset daily at 00:00 UTC. Admins and owners are exempt.');
          return interaction.editReply({ embeds: [limitEmbed] });
        }
        limitRecord.count += 1;
        limitRecord.lastUsed = now;
      }
      await limitRecord.save();
    }
  }

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.groqApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile', // Upgraded to Llama 3.3 70B for better accuracy
        messages: [
          {
            role: 'system',
            content: 'You are a helpful AI assistant. Answer the user\'s question clearly and concisely. Keep the response under 1800 characters so it fits within a single Discord message.'
          },
          {
            role: 'user',
            content: question
          }
        ],
        temperature: 0.7,
        max_tokens: 1024
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      logger.error(`Groq API returned status ${response.status}: ${errText}`);
      throw new Error(`Groq API Error (Status ${response.status})`);
    }

    const responseData = await response.json();
    const answer = responseData.choices?.[0]?.message?.content;

    if (!answer) {
      throw new Error('No response returned from Groq API');
    }

    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('Ask AI')
      .addFields(
        { name: 'Question', value: question.length > 256 ? question.slice(0, 253) + '...' : question }
      )
      .setDescription(answer.length > 4000 ? answer.slice(0, 3950) + '\n\n*(response truncated due to Discord limit)*' : answer)
      .setFooter({ text: `Asked by ${interaction.user.tag}` })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });

  } catch (err) {
    logger.error(`Error executing /ask command: ${err.message}`, err);
    await interaction.editReply({
      embeds: [errorEmbed('An error occurred while getting response from the AI. Please try again later.')]
    });
  }
}
