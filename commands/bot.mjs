import {
    clearGeminiHistory,
    getGeminiStatus,
    setGeminiEnabled
} from '../handlers/geminiMentionHandler.mjs';

export const name = 'talkbot';
export const description = 'Bật/tắt Gemini trả lời khi tài khoản được mention hoặc reply';
export const permission = 'everyone';

export async function execute(_message, args) {
    const action = String(args[0] || 'status').toLowerCase();

    if (action === 'on') {
        setGeminiEnabled(true);
        return '✅ TalkBot Gemini đã BẬT. Tài khoản sẽ trả lời khi được mention hoặc reply.';
    }
    if (action === 'off') {
        setGeminiEnabled(false);
        return '⛔ TalkBot Gemini đã TẮT.';
    }
    if (action === 'clear') {
        const cleared = clearGeminiHistory();
        return `🧹 Đã xóa ${cleared} bộ nhớ hội thoại Gemini.`;
    }

    const status = getGeminiStatus();
    const retryLine = status.nextKeyRetryMs > 0
        ? `Key gần nhất thử lại: khoảng ${Math.max(1, Math.ceil(status.nextKeyRetryMs / 60000))} phút`
        : null;
    const groqRetryLine = status.nextGroqKeyRetryMs > 0
        ? `Groq thử lại: khoảng ${Math.max(1, Math.ceil(status.nextGroqKeyRetryMs / 60000))} phút`
        : null;
    const tokenRouterRetryLine = status.nextTokenRouterKeyRetryMs > 0
        ? `TokenRouter thử lại: khoảng ${Math.max(1, Math.ceil(status.nextTokenRouterKeyRetryMs / 60000))} phút`
        : null;
    return [
        `TalkBot: ${status.enabled ? 'BẬT' : 'TẮT'}`,
        `Gemini: ${status.model} — ${status.availableApiKeys}/${status.apiKeyCount} key sẵn sàng`,
        `Groq dự phòng: ${status.groqModel} — ${status.availableGroqApiKeys}/${status.groqApiKeyCount} key sẵn sàng`,
        `TokenRouter dự phòng: ${status.tokenRouterModel} — ${status.availableTokenRouterApiKeys}/${status.tokenRouterApiKeyCount} key sẵn sàng`,
        retryLine,
        groqRetryLine,
        tokenRouterRetryLine,
        `Tài khoản AI: ${status.managedAccounts}`,
        `Hội thoại đang nhớ: ${status.conversations}`,
        'Lệnh: ;talkbot on | off | clear | status'
    ].filter(Boolean).join('\n');
}
