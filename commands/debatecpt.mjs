import { excludeDebateAccount } from '../handlers/debateRoster.mjs';

export const name = 'debatecpt';
export const permission = 'everyone';
export const description = 'Loại chính tài khoản gửi lệnh khỏi phiên debate hiện tại trong kênh';

export async function execute(message, args, client) {
    const userId = message?.author?.id;
    if (!userId || userId !== client?.user?.id) return '❌ Chỉ có thể loại chính tài khoản gửi lệnh.';
    const result = excludeDebateAccount(message?.channel?.id, userId);
    if (result.status === 'inactive') return 'ℹ️ Kênh này chưa có phiên debate hoặc debatevoz đang chạy.';
    if (result.status === 'not-participant') return 'ℹ️ Tài khoản này không tham gia phiên debate hiện tại.';
    return result.stopped
        ? `⏹️ Đã loại tài khoản gửi lệnh khỏi ${result.mode}. Phiên dừng vì còn dưới 2 tài khoản.`
        : `✅ Đã loại tài khoản gửi lệnh khỏi ${result.mode}. Còn ${result.remaining} tài khoản tiếp tục.`;
}
