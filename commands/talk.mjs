export const name = 'talk';
export const description = 'Gửi tin nhắn bằng nhiều tài khoản, hỗ trợ reply';
export const permission = 'everyone';

import { clients } from '../index.mjs';

export async function execute(message, args, client) {
    if (args.length === 0) {
        return "❌ Cách dùng: `;talk [tài khoản] [nội dung] [tài khoản reply] [nội dung] (r)`";
    }

    await message.delete().catch(() => {});

    let senderIndex = null; // null = tất cả, hoặc số thứ tự (1-based)
    let contentToSend = '';
    let replyTargetIndex = null;
    let replyContent = '';
    let shouldReply = false;

    // Xử lý cú pháp linh hoạt
    let i = 0;

    // Kiểm tra nếu phần tử đầu là số → chọn tài khoản gửi
    if (!isNaN(args[0]) && parseInt(args[0]) > 0) {
        senderIndex = parseInt(args[0]) - 1; // chuyển sang 0-based
        i = 1;
    }

    // Nếu không có số ở đầu → tất cả tài khoản gửi
    if (senderIndex === null) {
        // Tìm vị trí từ "số" đến trước số tiếp theo hoặc (r)
        let startContent = i;
        while (i < args.length && (isNaN(args[i]) || args[i].includes('.'))) {
            if (args[i].toLowerCase() === '(r)' || args[i].toLowerCase() === '(n)') break;
            i++;
        }
        contentToSend = args.slice(startContent, i).join(' ').trim();
        if (!contentToSend) return "❌ Thiếu nội dung để gửi!";
    } else {
        // Có chỉ định tài khoản gửi → lấy nội dung tiếp theo
        let startContent = i;
        while (i < args.length && isNaN(args[i]) && !args[i].startsWith('(')) {
            i++;
        }
        contentToSend = args.slice(startContent, i).join(' ').trim();
        if (!contentToSend) return "❌ Thiếu nội dung để gửi!";
    }

    // Kiểm tra xem có phần reply không
    if (i < args.length && !isNaN(args[i])) {
        replyTargetIndex = parseInt(args[i]) - 1;
        i++;

        let replyStart = i;
        while (i < args.length && !args[i].toLowerCase().includes('(r)') && !args[i].toLowerCase().includes('(n)')) {
            i++;
        }
        replyContent = args.slice(replyStart, i).join(' ').trim();

        if (i < args.length) {
            const flag = args[i].toLowerCase();
            if (flag === '(r)') shouldReply = true;
            else if (flag === '(n)') shouldReply = false;
            else shouldReply = true; // mặc định reply nếu có số + nội dung
        } else {
            shouldReply = true; // mặc định reply nếu có tài khoản + nội dung
        }
    }

    const channel = message.channel;

    try {
        // Gửi tin nhắn chính
        const senders = senderIndex === null ? clients : [clients[senderIndex]];

        for (const sender of senders) {
            if (!sender || !sender.user) continue;
            if (senderIndex !== null && sender !== clients[senderIndex]) continue;

            await channel.sendTyping();
            await new Promise(r => setTimeout(r, Math.random() * 1500 + 500));
            await channel.send({ content: contentToSend });
        }

        // Gửi reply (nếu có)
        if (replyTargetIndex !== null && replyContent && clients[replyTargetIndex]) {
            const replyClient = clients[replyTargetIndex];
            const lastMessage = (await channel.messages.fetch({ limit: 1 })).first();

            await channel.sendTyping();
            await new Promise(r => setTimeout(r, Math.random() * 2000 + 800));

            if (shouldReply && lastMessage && lastMessage.author.id !== replyClient.user.id) {
                await lastMessage.reply({ content: replyContent }).catch(() => {
                    channel.send(replyContent);
                });
            } else {
                await channel.send({ content: replyContent });
            }
        }

        return `✅ Đã gửi tin nhắn thành công!`;
    } catch (err) {
        console.error('Lỗi khi dùng lệnh talk:', err);
        return `❌ Lỗi: ${err.message}`;
    }
}