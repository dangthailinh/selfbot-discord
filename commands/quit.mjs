// commands/quit.mjs
import chalk from 'chalk';
import { clients } from '../index.mjs'; // Đường dẫn đến file chính (nơi export clients)

export const name = 'quit';
export const description = 'Rời toàn bộ server cũ (>4 ngày) trên TẤT CẢ các tài khoản đang login';
export const permission = 'everyone';

const KEEP_GUILD_ID = '1032835763760529509';     // Server không bao giờ rời
const DAYS_THRESHOLD = 4;                     // Tham gia >4 ngày thì rời
const DELAY_BETWEEN_ACCOUNTS = 8000;          // Delay giữa mỗi tài khoản (8 giây)
const DELAY_BETWEEN_LEAVES = 6000;            // Delay giữa mỗi lần rời server (6 giây)

export async function execute(message, args, client) {
    await message.delete().catch(() => {});

    if (clients.length === 0) {
        return 'Không có tài khoản nào đang online.';
    }

    console.log(chalk.bold.magenta('\n🚀 BẮT ĐẦU DỌN SERVER CŨ TRÊN TOÀN BỘ TÀI KHOẢN'));
    console.log(chalk.gray('═'.repeat(90)));

    let totalLeft = 0;

    for (let i = 0; i < clients.length; i++) {
        const acc = clients[i];
        if (!acc.user) continue; // Bỏ qua nếu chưa login xong

        console.log(chalk.bold.cyan(`\n[${i + 1}/${clients.length}] Đang xử lý: ${acc.user.username}#${acc.user.discriminator} (${acc.user.id})`));
        console.log(chalk.gray('-'.repeat(80)));

        const now = Date.now();
        const thresholdTime = DAYS_THRESHOLD * 24 * 60 * 60 * 1000;
        const guildsToLeave = [];

        let kept = 0;
        acc.guilds.cache.forEach(guild => {
            if (guild.id === KEEP_GUILD_ID) {
                kept++;
                console.log(chalk.green(`✔ Giữ lại server chính: ${guild.name}`));
                return;
            }

            const member = guild.members.cache.get(acc.user.id);
            if (!member?.joinedTimestamp) return;

            const daysSinceJoin = (now - member.joinedTimestamp) / (1000 * 60 * 60 * 24);

            if (daysSinceJoin > DAYS_THRESHOLD) {
                guildsToLeave.push({ guild, days: daysSinceJoin.toFixed(1) });
            } else {
                console.log(chalk.yellow(`⚡ Giữ: ${guild.name} (${daysSinceJoin.toFixed(1)} ngày)`));
            }
        });

        if (guildsToLeave.length === 0) {
            console.log(chalk.green(`✅ ${acc.user.username} sạch sẽ, không cần rời server nào.\n`));
            continue;
        }

        console.log(chalk.red(`❌ Sẽ rời ${guildsToLeave.length} server cũ:\n`));

        for (const { guild, days } of guildsToLeave) {
            console.log(chalk.red(`   ➤ Đang rời: ${guild.name.padEnd(30)} (${days} ngày)`));
            try {
                await guild.leave();
                console.log(chalk.magenta(`      → Đã rời thành công!\n`));
                totalLeft++;
            } catch (err) {
                console.log(chalk.red(`      → Lỗi: ${err.message}\n`));
            }
            await new Promise(r => setTimeout(r, DELAY_BETWEEN_LEAVES));
        }

        console.log(chalk.bold.green(`✔ Hoàn tất tài khoản ${acc.user.username} – Còn lại ${acc.guilds.cache.size} server\n`));

        // Delay trước khi sang tài khoản tiếp theo
        if (i < clients.length - 1) {
            console.log(chalk.gray(`⏳ Chờ ${DELAY_BETWEEN_ACCOUNTS/1000}s trước tài khoản tiếp theo...\n`));
            await new Promise(r => setTimeout(r, DELAY_BETWEEN_ACCOUNTS));
        }
    }

    console.log(chalk.bold.green('🎉 HOÀN TẤT TOÀN BỘ!'));
    console.log(chalk.cyan(`   → Tổng cộng đã rời: ${totalLeft} server trên ${clients.length} tài khoản\n`));
    console.log(chalk.gray('═'.repeat(90)));

    return `Đã dọn xong toàn bộ ${clients.length} tài khoản!\nTổng rời: ${totalLeft} server cũ.`;
}