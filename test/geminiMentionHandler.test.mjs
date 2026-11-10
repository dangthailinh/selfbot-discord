import test from 'node:test';
import assert from 'node:assert/strict';
import {
    configureGeminiClients,
    detectGeminiTrigger,
    generateGeminiContent,
    getGeminiKeyStatus,
    getGroqKeyStatus,
    getTokenRouterKeyStatus,
    handleGeminiMention,
    resetGeminiKeyHealth,
    resetGroqKeyHealth,
    resetTokenRouterKeyHealth,
    resolvePersonality,
    stripModelReasoning
} from '../handlers/geminiMentionHandler.mjs';

function makeClient(id = '100', username = 'account-one', index = 0) {
    return { user: { id, username }, aiAccountIndex: index };
}

function makeMessage({ authorId = '200', content = '', mentionedIds = [], referencedMessage = null } = {}) {
    return {
        id: 'message-1',
        content,
        author: { id: authorId, username: 'visitor', bot: false },
        mentions: { users: { has: id => mentionedIds.includes(id) } },
        reference: referencedMessage ? { messageId: referencedMessage.id } : null,
        fetchReference: referencedMessage ? async () => referencedMessage : undefined,
        channel: { id: 'channel-1' }
    };
}

test('chỉ kích hoạt tài khoản được mention', async () => {
    const first = makeClient('100', 'first', 0);
    const second = makeClient('101', 'second', 1);
    configureGeminiClients([first, second]);
    const message = makeMessage({ content: '<@100> xin chào', mentionedIds: ['100'] });
    assert.equal((await detectGeminiTrigger(message, first)).triggered, true);
    assert.equal((await detectGeminiTrigger(message, second)).triggered, false);
});

test('kích hoạt khi reply đúng tin nhắn của tài khoản', async () => {
    const client = makeClient();
    configureGeminiClients([client]);
    const message = makeMessage({
        content: 'ý bạn là sao?',
        referencedMessage: { id: 'old-message', author: { id: '100' }, content: 'Tin trước' }
    });
    const trigger = await detectGeminiTrigger(message, client);
    assert.equal(trigger.triggered, true);
    assert.equal(trigger.kind, 'reply');
});

test('tài khoản cùng nhóm vẫn có thể mention nhau thủ công', async () => {
    const first = makeClient('100', 'first', 0);
    const second = makeClient('101', 'second', 1);
    configureGeminiClients([first, second]);
    const message = makeMessage({ authorId: '101', content: '<@100> trả lời đi', mentionedIds: ['100'] });
    assert.equal((await detectGeminiTrigger(message, first)).triggered, true);
});

test('các tài khoản được gán nhân cách riêng theo thứ tự đăng nhập', () => {
    const first = makeClient('100', 'first', 0);
    const second = makeClient('101', 'second', 1);
    configureGeminiClients([first, second]);
    assert.equal(resolvePersonality(first).name, 'Điềm tĩnh');
    assert.equal(resolvePersonality(second).name, 'Hài hước');
    assert.notEqual(resolvePersonality(first).name, resolvePersonality(second).name);
});

test('gọi Gemini và reply Discord bằng cấu hình môi trường', async () => {
    const originalFetch = globalThis.fetch;
    const previousEnv = {
        keys: process.env.GEMINI_API_KEYS,
        model: process.env.GEMINI_MODEL,
        cooldown: process.env.GEMINI_USER_COOLDOWN_MS,
        minDelay: process.env.GEMINI_REPLY_DELAY_MIN_MS,
        maxDelay: process.env.GEMINI_REPLY_DELAY_MAX_MS
    };
    const client = makeClient();
    configureGeminiClients([client]);
    let sentReply = null;
    let requestedUrl = null;
    const message = {
        ...makeMessage({ content: '<@100> bạn khỏe không?', mentionedIds: ['100'] }),
        id: 'api-message',
        guild: { id: 'guild-1' },
        channel: { id: 'channel-1', sendTyping: async () => {}, send: async value => value },
        reply: async options => {
            sentReply = options;
            return options;
        }
    };

    process.env.GEMINI_API_KEYS = 'test-key';
    process.env.GEMINI_MODEL = 'gemini-3.6-flash';
    process.env.GEMINI_USER_COOLDOWN_MS = '0';
    process.env.GEMINI_REPLY_DELAY_MIN_MS = '0';
    process.env.GEMINI_REPLY_DELAY_MAX_MS = '0';
    globalThis.fetch = async url => {
        requestedUrl = String(url);
        return {
            ok: true,
            json: async () => ({
                candidates: [{ content: { parts: [{ text: 'Mình khỏe, cảm ơn bạn!' }] } }]
            })
        };
    };

    try {
        await handleGeminiMention(message, client);
        assert.match(requestedUrl, /gemini-3\.6-flash:generateContent/);
        assert.equal(sentReply.content, 'Mình khỏe, cảm ơn bạn!');
        assert.deepEqual(sentReply.allowedMentions.parse, []);
    } finally {
        globalThis.fetch = originalFetch;
        for (const [key, value] of Object.entries({
            GEMINI_API_KEYS: previousEnv.keys,
            GEMINI_MODEL: previousEnv.model,
            GEMINI_USER_COOLDOWN_MS: previousEnv.cooldown,
            GEMINI_REPLY_DELAY_MIN_MS: previousEnv.minDelay,
            GEMINI_REPLY_DELAY_MAX_MS: previousEnv.maxDelay
        })) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    }
});

test('429 làm cooldown key hiện tại rồi chuyển sang key kế tiếp', async () => {
    const originalFetch = globalThis.fetch;
    const previousKeys = process.env.GEMINI_API_KEYS;
    const previousMaxKeys = process.env.GEMINI_MAX_KEYS_PER_REQUEST;
    process.env.GEMINI_API_KEYS = 'key-a,key-b';
    process.env.GEMINI_MAX_KEYS_PER_REQUEST = '2';
    resetGeminiKeyHealth();
    const requestedUrls = [];

    globalThis.fetch = async url => {
        requestedUrls.push(String(url));
        if (requestedUrls.length === 1) {
            return {
                ok: false,
                status: 429,
                headers: { get: () => null },
                json: async () => ({
                    error: {
                        message: 'Resource exhausted',
                        details: [{
                            '@type': 'type.googleapis.com/google.rpc.RetryInfo',
                            retryDelay: '90s'
                        }]
                    }
                })
            };
        }
        return {
            ok: true,
            status: 200,
            json: async () => ({
                candidates: [{ content: { parts: [{ text: 'ổn rồi' }] } }]
            })
        };
    };

    try {
        const result = await generateGeminiContent('system', [{
            role: 'user',
            parts: [{ text: 'hello' }]
        }]);
        assert.equal(result, 'ổn rồi');
        assert.equal(requestedUrls.length, 2);
        assert.match(requestedUrls[0], /key=key-a/);
        assert.match(requestedUrls[1], /key=key-b/);
        assert.deepEqual(
            {
                configured: getGeminiKeyStatus().configured,
                available: getGeminiKeyStatus().available,
                coolingDown: getGeminiKeyStatus().coolingDown
            },
            { configured: 2, available: 1, coolingDown: 1 }
        );
    } finally {
        globalThis.fetch = originalFetch;
        if (previousKeys === undefined) delete process.env.GEMINI_API_KEYS;
        else process.env.GEMINI_API_KEYS = previousKeys;
        if (previousMaxKeys === undefined) delete process.env.GEMINI_MAX_KEYS_PER_REQUEST;
        else process.env.GEMINI_MAX_KEYS_PER_REQUEST = previousMaxKeys;
        resetGeminiKeyHealth();
    }
});

test('mọi key bị 429 trả lỗi có thời gian cooldown thay vì thử vô hạn', async () => {
    const originalFetch = globalThis.fetch;
    const previousKeys = process.env.GEMINI_API_KEYS;
    process.env.GEMINI_API_KEYS = 'key-one,key-two';
    resetGeminiKeyHealth();
    let calls = 0;
    globalThis.fetch = async () => {
        calls += 1;
        return {
            ok: false,
            status: 429,
            headers: { get: () => '60' },
            json: async () => ({ error: { message: 'Requests per minute exceeded' } })
        };
    };

    try {
        await assert.rejects(
            generateGeminiContent('system', [{ role: 'user', parts: [{ text: 'hello' }] }]),
            error => error.code === 'GEMINI_KEYS_COOLDOWN'
                && error.quotaLimited === true
                && error.retryAfterMs >= 60000
        );
        assert.equal(calls, 2);
        assert.equal(getGeminiKeyStatus().available, 0);
    } finally {
        globalThis.fetch = originalFetch;
        if (previousKeys === undefined) delete process.env.GEMINI_API_KEYS;
        else process.env.GEMINI_API_KEYS = previousKeys;
        resetGeminiKeyHealth();
    }
});

test('tự chuyển sang Groq khi Gemini bị từ chối', async () => {
    const originalFetch = globalThis.fetch;
    const previousEnv = {
        geminiKeys: process.env.GEMINI_API_KEYS,
        groqKeys: process.env.GROQ_API_KEYS,
        groqModel: process.env.GROQ_MODEL,
        geminiMax: process.env.GEMINI_MAX_KEYS_PER_REQUEST
    };
    process.env.GEMINI_API_KEYS = 'gemini-test-key';
    process.env.GROQ_API_KEYS = 'groq-test-key';
    process.env.GROQ_MODEL = 'qwen/qwen3.6-27b';
    process.env.GEMINI_MAX_KEYS_PER_REQUEST = '1';
    resetGeminiKeyHealth();
    resetGroqKeyHealth();
    const requests = [];

    globalThis.fetch = async (url, options) => {
        requests.push({ url: String(url), options });
        if (String(url).includes('generativelanguage.googleapis.com')) {
            return {
                ok: false,
                status: 429,
                headers: { get: () => '60' },
                json: async () => ({ error: { message: 'quota exceeded' } })
            };
        }
        return {
            ok: true,
            status: 200,
            json: async () => ({
                choices: [{ message: { content: 'Groq đã trả lời' } }]
            })
        };
    };

    try {
        const result = await generateGeminiContent('system', [{
            role: 'user',
            parts: [{ text: 'hello' }]
        }]);
        assert.equal(result, 'Groq đã trả lời');
        assert.equal(requests.length, 2);
        assert.match(requests[1].url, /api\.groq\.com\/openai\/v1\/chat\/completions/);
        assert.equal(requests[1].options.headers.Authorization, 'Bearer groq-test-key');
        const groqBody = JSON.parse(requests[1].options.body);
        assert.equal(groqBody.model, 'qwen/qwen3.6-27b');
        assert.equal(groqBody.reasoning_effort, 'none');
        assert.equal(groqBody.reasoning_format, 'hidden');
        assert.equal(getGroqKeyStatus().available, 1);
    } finally {
        globalThis.fetch = originalFetch;
        const restored = {
            GEMINI_API_KEYS: previousEnv.geminiKeys,
            GROQ_API_KEYS: previousEnv.groqKeys,
            GROQ_MODEL: previousEnv.groqModel,
            GEMINI_MAX_KEYS_PER_REQUEST: previousEnv.geminiMax
        };
        for (const [name, value] of Object.entries(restored)) {
            if (value === undefined) delete process.env[name];
            else process.env[name] = value;
        }
        resetGeminiKeyHealth();
        resetGroqKeyHealth();
    }
});

test('tự chuyển sang TokenRouter Qwen khi Gemini và Groq không dùng được', async () => {
    const originalFetch = globalThis.fetch;
    const previousEnv = Object.fromEntries([
        'GEMINI_API_KEYS',
        'GROQ_API_KEYS',
        'TOKENROUTER_API_KEYS',
        'TOKENROUTER_MODEL'
    ].map(name => [name, process.env[name]]));
    process.env.GEMINI_API_KEYS = 'gemini-test-key';
    process.env.GROQ_API_KEYS = 'groq-test-key';
    process.env.TOKENROUTER_API_KEYS = 'tokenrouter-test-key';
    process.env.TOKENROUTER_MODEL = 'qwen/qwen3.8-max-free';
    resetGeminiKeyHealth();
    resetGroqKeyHealth();
    resetTokenRouterKeyHealth();
    const requests = [];

    globalThis.fetch = async (url, options) => {
        requests.push({ url: String(url), options });
        if (!String(url).includes('api.tokenrouter.com')) {
            return {
                ok: false,
                status: 429,
                headers: { get: () => '60' },
                json: async () => ({ error: { message: 'quota exceeded' } })
            };
        }
        return {
            ok: true,
            status: 200,
            json: async () => ({
                choices: [{ message: { content: 'Qwen đã trả lời' } }]
            })
        };
    };

    try {
        const result = await generateGeminiContent('system', [{
            role: 'user',
            parts: [{ text: 'hello' }]
        }]);
        assert.equal(result, 'Qwen đã trả lời');
        assert.equal(requests.length, 3);
        assert.equal(requests[2].url, 'https://api.tokenrouter.com/v1/chat/completions');
        assert.equal(requests[2].options.headers.Authorization, 'Bearer tokenrouter-test-key');
        const body = JSON.parse(requests[2].options.body);
        assert.equal(body.model, 'qwen/qwen3.8-max-free');
        assert.equal(body.messages[0].role, 'system');
        assert.equal(getTokenRouterKeyStatus().available, 1);
    } finally {
        globalThis.fetch = originalFetch;
        for (const [name, value] of Object.entries(previousEnv)) {
            if (value === undefined) delete process.env[name];
            else process.env[name] = value;
        }
        resetGeminiKeyHealth();
        resetGroqKeyHealth();
        resetTokenRouterKeyHealth();
    }
});

test('loại bỏ suy luận Qwen và chỉ giữ câu trả lời cuối', () => {
    assert.equal(
        stripModelReasoning(
            '<think>Phân tích rất dài ở đây.</think>\nừ t cũng thấy vậy'
        ),
        'ừ t cũng thấy vậy'
    );
    assert.equal(
        stripModelReasoning(
            '<think>\nHere is a thinking process.\n1. Analyze User Input'
        ),
        ''
    );
    assert.equal(
        stripModelReasoning(
            'reasoning bị thiếu thẻ mở</think>\ntrả lời ngắn'
        ),
        'trả lời ngắn'
    );
});
