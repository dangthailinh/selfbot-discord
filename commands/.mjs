// commands/emoji.mjs
import { clients } from '../index.mjs';
import chalk from 'chalk';

export const name = 'emoji';
export const description = 'Tất cả tài khoản sẽ đồng loạt react nhiều emoji vào một message. Dùng: ;emoji <message_id> <emoji1> <emoji2> ...';

export async function execute(message, args, client) {
    if (args.length < 2) {
        return '❌ Cú pháp: `;emoji <message_id> <emoji1> <emoji2> ...>`';
    }

    const messageId = args[0];
    const emojis = args.slice(1); // Lấy TẤT CẢ emoji
    const channelId = message.channel.id;

    console.log(chalk.cyan(
        `[EMOJI] Bắt đầu react ${emojis.join(' ')} vào message ${messageId} trong channel ${channelId} từ tất cả ${clients.length} clients...`
    ));

    const results = [];

    const promises = clients.map(async (cl, index) => {
        try {
            const ch = await cl.channels.fetch(channelId);
            const msg = await ch.messages.fetch(messageId);

            for (const emoji of emojis) {
                try {
                    await msg.react(emoji);
                    console.log(chalk.green(`[EMOJI] Client ${index + 1} (${cl.user.username}) react "${emoji}" OK`));
                } catch (err) {
                    console.log(chalk.red(`[EMOJI] Lỗi react emoji "${emoji}" trên client ${index + 1}: ${err.message}`));
                }
            }

            results.push(`✅ Client ${index + 1} (${cl.user.username}) done`);
        } catch (err) {
            const errorMsg = `❌ Client ${index + 1} (${cl.user.username}): ${err.message}`;
            results.push(errorMsg);
            console.error(chalk.red(`[EMOJI] Lỗi on client ${index + 1}:`), err.message);
        }
    });

    await Promise.all(promises);

    const successCount = results.filter(r => r.startsWith('✅')).length;

    const summary =
        `📊 Kết quả react ${emojis.join(' ')} vào message ${messageId}:\n` +
        results.join('\n') +
        `\n\nTổng: ${successCount}/${clients.length} clients thành công.`;

    const sent = await message.channel.send(`\`\`\`${summary}\`\`\``);
    setTimeout(() => sent.delete().catch(() => {}), 30000);

    return summary;
}
