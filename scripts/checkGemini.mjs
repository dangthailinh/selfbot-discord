import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
dotenv.config({ path: path.join(root, '.env') });
dotenv.config({ path: path.join(root, '.env.local'), override: true });

const keys = String(process.env.GEMINI_API_KEYS || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
const model = String(process.env.GEMINI_MODEL || 'gemini-3.6-flash');

if (keys.length === 0) {
    console.error('Không tìm thấy GEMINI_API_KEYS.');
    process.exitCode = 1;
} else {
    const checks = [];
    for (let index = 0; index < keys.length; index++) {
        try {
            const response = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}?key=${encodeURIComponent(keys[index])}`
            );
            checks.push({ key: index + 1, status: response.status, ok: response.ok });
        } catch (_) {
            checks.push({ key: index + 1, status: 'network-error', ok: false });
        }
    }
    console.log('Kiểm tra key:', checks);

    const usableIndex = checks.findIndex(check => check.ok);
    if (usableIndex === -1) {
        console.error('Không có key Gemini hợp lệ.');
        process.exitCode = 1;
    } else {
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(keys[usableIndex])}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    systemInstruction: {
                        parts: [{ text: "You are i'm just a bot. Reply in one very short sentence." }]
                    },
                    contents: [{ role: 'user', parts: [{ text: 'Say hello briefly.' }] }],
                    generationConfig: {
                        maxOutputTokens: 256,
                        thinkingConfig: { thinkingLevel: 'minimal' }
                    }
                })
            }
        );
        const data = await response.json().catch(() => ({}));
        const output = (data?.candidates?.[0]?.content?.parts || [])
            .filter(part => typeof part?.text === 'string' && !part.thought)
            .map(part => part.text)
            .join(' ')
            .trim();
        console.log('Kiểm tra tạo phản hồi:', { status: response.status, ok: response.ok, output });
        if (!response.ok || !output) process.exitCode = 1;
    }
}
