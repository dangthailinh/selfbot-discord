// commands/chatall.mjs
import { clients } from '../index.mjs';
import chalk from 'chalk';

export const name = 'chatall';
export const description = 'Tất cả tài khoản sẽ chat text lần lượt. Dùng: ;chatall <nội dung>';

export async function execute(message, args, client) {
    if (args.length < 1) {
        return '❌ Cú pháp: `;chatall <nội dung tin nhắn>`';
    }

    const text = args.join(' ');
    const channelId = message.channel.id;

    console.log(chalk.cyan(
        `[CHATALL] Bắt đầu gửi "${text}" từ tất cả ${clients.length} clients...`
    ));

    const results = [];

    // Gửi lần lượt (tuần tự), không phải đồng loạt
    for (let i = 0; i < clients.length; i++) {
        const cl = clients[i];
        try {
            const channel = await cl.channels.fetch(channelId);
            await channel.send(text);

            console.log(chalk.green(`[CHATALL] Client ${i + 1} (${cl.user.username}) gửi OK`));
            results.push(`✅ Client ${i + 1} (${cl.user.username})`);

            // Delay nhỏ giữa các client để tránh rate limit
            if (i < clients.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        } catch (err) {
            console.log(chalk.red(`[CHATALL] Lỗi client ${i + 1}: ${err.message}`));
            results.push(`❌ Client ${i + 1} (${cl.user.username}): ${err.message}`);
        }
    }

    const successCount = results.filter(r => r.startsWith('✅')).length;

    const summary =
        `📊 Kết quả gửi tin nhắn:\n` +
        `📝 Nội dung: ${text}\n` +
        results.join('\n') +
        `\n\nTổng: ${successCount}/${clients.length} clients thành công.`;

    const sent = await message.channel.send(`\`\`\`${summary}\`\`\``);
    setTimeout(() => sent.delete().catch(() => {}), 30000);

    return summary;
}