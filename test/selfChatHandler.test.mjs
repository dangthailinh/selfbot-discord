import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildLocalSelfChatReply,
    chooseSpeaker,
    chooseConversationGroupSize,
    chooseMessageLengthMode,
    detectSelfChatLoop,
    ensureConversationTurnover,
    extractDiscordGifCandidate,
    formatLongSelfChatText,
    getRepeatedSelfChatTerms,
    getSpeakerWeight,
    hasLongPairStreak,
    handleSelfChatCommand,
    isNearDuplicateSelfChat,
    isStagnantSelfChatReply,
    nextExpectedSpeakerAfterTurn,
    parseSelfChatCommand,
    selectContextualMedia,
    selectChatStyle,
    shouldUseLocalSelfChatReply,
    shouldSendMedia,
    shortenSelfChatText,
    stripSelfChatEmojis
} from '../handlers/selfChatHandler.mjs';
import {
    isGeminiEnabled,
    setGeminiEnabled
} from '../handlers/geminiMentionHandler.mjs';

test('nhận lệnh selfchat không có chủ đề', () => {
    assert.deepEqual(parseSelfChatCommand('!selfchat'), { type: 'start', topic: null });
});

test('nhận và làm sạch chủ đề selfchat', () => {
    assert.deepEqual(
        parseSelfChatCommand('  !selfchat   AI trong giáo dục  '),
        { type: 'start', topic: 'AI trong giáo dục' }
    );
});

test('nhận lệnh kết thúc chính xác', () => {
    assert.deepEqual(parseSelfChatCommand('!selfchatend'), { type: 'end' });
    assert.equal(parseSelfChatCommand('!selfchatending'), null);
});

test('nhận chính xác lệnh tắt Gemini chat trên toàn bộ tài khoản', () => {
    assert.deepEqual(parseSelfChatCommand('!offall'), { type: 'offall' });
    assert.deepEqual(parseSelfChatCommand('  !OFFALL  '), { type: 'offall' });
    assert.equal(parseSelfChatCommand('!offallnow'), null);
});

test('lệnh !offall tắt công tắc Gemini dùng chung của mọi tài khoản', async () => {
    const clients = [{ user: { id: 'managed-1' } }, { user: { id: 'managed-2' } }];
    let notice = '';
    setGeminiEnabled(true);

    try {
        const handled = await handleSelfChatCommand({
            id: `offall-${Date.now()}`,
            content: '!offall',
            author: { id: 'managed-1' },
            channel: {
                id: 'offall-test-channel',
                send: async payload => {
                    notice = payload.content;
                    return payload;
                }
            }
        }, clients);

        assert.equal(handled, true);
        assert.equal(isGeminiEnabled(), false);
        assert.match(notice, /toàn bộ 2 tài khoản/);
    } finally {
        setGeminiEnabled(true);
    }
});

test('nhận lệnh xem trạng thái bộ nhớ lâu dài', () => {
    assert.deepEqual(parseSelfChatCommand('!selfchatmemory'), { type: 'memory' });
});

test('nhận lệnh xem trạng thái quota Gemini', () => {
    assert.deepEqual(parseSelfChatCommand('!selfchatquota'), { type: 'quota' });
});

test('nhận lệnh xem tài khoản đang tham gia selfchat', () => {
    assert.deepEqual(parseSelfChatCommand('!selfchatstatus'), { type: 'status' });
});

test('lượt cục bộ giảm số lần gọi Gemini và không dùng cho đáp bắt buộc', () => {
    const session = {
        recentMessages: [{ content: 'hello' }, { content: 'ừ' }],
        sceneMode: 'đối đáp thân mật'
    };
    assert.equal(shouldUseLocalSelfChatReply(session, false, 0), true);
    assert.equal(shouldUseLocalSelfChatReply(session, true, 0), false);
    assert.equal(typeof buildLocalSelfChatReply(session, {}, 0.2), 'string');
});

test('rút gọn câu dài để tránh văn phong diễn giải', () => {
    const result = shortenSelfChatText(
        'Đây là một câu trả lời cực kỳ dài dòng và không phù hợp với cách nói chuyện ngắn trên Discord nên cần được rút gọn ngay lập tức.',
        70
    );
    assert.ok(result.length <= 71);
    assert.ok(result.split(/\s+/).length <= 16);
});

test('chỉ giữ câu đầu khi Gemini trả về nhiều câu', () => {
    assert.equal(
        shortenSelfChatText('Ừ cũng đúng đó. Nhưng nếu nhìn theo một góc độ khác thì còn rất nhiều điều cần phân tích.'),
        'Ừ cũng đúng đó.'
    );
});

test('ưu tiên đúng tài khoản vừa được reply thay vì cho tài khoản thứ ba chen vào', () => {
    const makeParticipant = (id, turns) => ({
        client: { user: { id } },
        turns,
        failures: 0
    });
    const session = {
        participants: [
            makeParticipant('A', 2),
            makeParticipant('B', 5),
            makeParticipant('C', 0)
        ],
        lastSpeakerId: 'A',
        expectedSpeakerId: 'B'
    };

    assert.equal(chooseSpeaker(session).client.user.id, 'B');
});

test('lượt đáp bắt buộc kết thúc chuỗi thay vì ping-pong vô hạn', () => {
    assert.equal(
        nextExpectedSpeakerAfterTurn(false, { authorId: 'B' }),
        'B'
    );
    assert.equal(
        nextExpectedSpeakerAfterTurn(true, { authorId: 'A' }),
        null
    );
});

test('tài khoản lỗi chỉ cooldown tạm thời và tài khoản khỏe khác được nói', () => {
    const now = Date.now();
    const session = {
        participants: [
            { client: { user: { id: 'A' } }, blockedUntil: now + 60000, failures: 3 },
            { client: { user: { id: 'B' } }, blockedUntil: now + 60000, failures: 3 },
            { client: { user: { id: 'C' } }, blockedUntil: 0, failures: 0 }
        ],
        activeParticipantIds: new Set(['A', 'B', 'C']),
        lastSpeakerId: 'A',
        expectedSpeakerId: null,
        focusParticipantIds: new Set(),
        spotlightParticipantId: null
    };
    assert.equal(chooseSpeaker(session).client.user.id, 'C');
});

test('loại emoji do Gemini tự lặp khỏi tin văn bản', () => {
    assert.equal(stripSelfChatEmojis('chuẩn vội làm j 💀💀'), 'chuẩn vội làm j');
    assert.equal(stripSelfChatEmojis('chịu luôn 😂'), 'chịu luôn');
});

test('mỗi tài khoản giữ một nhịp nói ổn định nhưng vẫn chung nhân cách', () => {
    assert.equal(selectChatStyle('account-1'), selectChatStyle('account-1'));
    const styles = new Set(
        Array.from({ length: 12 }, (_, index) => selectChatStyle(`account-${index}`))
    );
    assert.ok(styles.size > 1);
});

test('tài khoản hoạt ngôn có trọng số tham gia cao hơn tài khoản ít nói', () => {
    const loud = {
        client: { user: { id: 'loud' } },
        personality: { talkWeight: 1.7 },
        turns: 2
    };
    const quiet = {
        client: { user: { id: 'quiet' } },
        personality: { talkWeight: 0.4 },
        turns: 2
    };
    const session = {
        participants: [loud, quiet],
        focusParticipantIds: new Set(),
        spotlightParticipantId: null
    };
    assert.ok(getSpeakerWeight(session, loud) > getSpeakerWeight(session, quiet) * 3);
});

test('phát hiện câu lặp hoặc gần giống để yêu cầu viết lại', () => {
    const recent = [{ content: 'ừ cũng đúng đó' }, { content: 'kể tiếp đi' }];
    assert.equal(isNearDuplicateSelfChat('ừ cũng đúng đó', recent), true);
    assert.equal(isNearDuplicateSelfChat('mai đi ăn phở k', recent), false);
});

test('ưu tiên nhóm nhỏ thay vì bắt toàn bộ tài khoản cùng nói', () => {
    assert.equal(chooseConversationGroupSize(9, 0.1), 2);
    assert.equal(chooseConversationGroupSize(9, 0.3), 3);
    assert.equal(chooseConversationGroupSize(9, 0.6), 3);
    assert.equal(chooseConversationGroupSize(9, 0.8), 4);
});

test('mỗi lần đổi cảnh phải đưa ít nhất một tài khoản mới vào nhóm', () => {
    const makeParticipant = (id, turns = 0) => ({
        client: { user: { id } },
        turns
    });
    const a = makeParticipant('A', 4);
    const b = makeParticipant('B', 4);
    const c = makeParticipant('C', 0);
    const rotated = ensureConversationTurnover(
        [a, b],
        [a, b, c],
        new Set(['A', 'B']),
        0
    );
    assert.deepEqual(rotated.map(item => item.client.user.id), ['A', 'C']);
});

test('phát hiện vòng lặp hai tài khoản chỉ xác nhận kế hoạch', () => {
    const messages = [
        { authorId: 'A', content: 'ok chốt, làm theo timeline này' },
        { authorId: 'B', content: 'ừ dc, cứ track tự nhiên nhé' },
        { authorId: 'A', content: 'đúng rồi, cuối tuần review tiến độ' },
        { authorId: 'B', content: 'ừ, cứ bám sát plan này' },
        { authorId: 'A', content: 'ok, report lại kết quả nha' },
        { authorId: 'B', content: 'tốt rồi, cứ theo dõi tiếp' }
    ];
    assert.equal(detectSelfChatLoop(messages), true);
    assert.equal(
        detectSelfChatLoop(messages.map((item, index) => ({
            ...item,
            authorId: `user-${index}`,
            content: `chủ đề khác nhau ${index}`
        }))),
        false
    );
});

test('gom các cách diễn đạt kế hoạch và tiến độ thành cùng một ý', () => {
    const terms = getRepeatedSelfChatTerms([
        { content: 'bám sát kế hoạch này' },
        { content: 'cứ theo dõi tiến độ' },
        { content: 'plan ổn thì track tiếp' },
        { content: 'review kế hoạch cuối tuần' },
        { content: 'report tiến độ sau nha' }
    ], 3);
    assert.ok(terms.includes('planning'));
    assert.ok(terms.includes('progress'));
});

test('chặn câu xác nhận thứ ba dù câu chữ không giống hệt', () => {
    const recent = [
        { content: 'ừ, cứ làm vậy đi' },
        { content: 'ok chốt theo plan này' }
    ];
    assert.equal(
        isStagnantSelfChatReply('đúng rồi, cứ bám thế nha', recent),
        true
    );
});

test('một cặp nói đủ sáu lượt sẽ buộc nhường chỗ cho tài khoản khác', () => {
    const messages = Array.from({ length: 6 }, (_, index) => ({
        authorId: index % 2 === 0 ? 'A' : 'B',
        content: `tin ${index}`
    }));
    assert.equal(hasLongPairStreak(messages, 6), true);
    messages[5].authorId = 'C';
    assert.equal(hasLongPairStreak(messages, 6), false);
});

test('tài khoản ngoài nhóm đang nói không chen vào dù có ít lượt hơn', () => {
    const makeParticipant = (id, turns) => ({ client: { user: { id } }, turns, failures: 0 });
    const session = {
        participants: [
            makeParticipant('A', 3),
            makeParticipant('B', 3),
            makeParticipant('C', 0)
        ],
        activeParticipantIds: new Set(['A', 'B']),
        lastSpeakerId: 'A',
        expectedSpeakerId: null
    };
    assert.equal(chooseSpeaker(session).client.user.id, 'B');
});

test('đoạn dài được chia thành nhiều dòng trong cùng một tin nhắn', () => {
    const input = 'game này ban đầu nhìn khá chán nhưng chơi lâu mới thấy cuốn vì mỗi map có cách xử lý khác nhau và đồ họa cũng ổn áp phết nhất là lúc chơi cùng bạn bè thì nhiều pha ngáo thật sự cười không chịu nổi còn chơi một mình thì hơi buồn ngủ';
    const output = formatLongSelfChatText(input);
    assert.ok(output.split('\n').length >= 3);
    assert.ok(output.length < 850);
});

test('tin dài có cooldown và không xuất hiện ở lượt đáp bắt buộc', () => {
    const base = {
        sceneMode: 'tranh luận nhẹ',
        turn: 20,
        lastLongTurn: 0,
        recentMessages: [{}, {}, {}]
    };
    assert.equal(chooseMessageLengthMode(base, false, 0.01), 'long');
    assert.notEqual(chooseMessageLengthMode(base, true, 0.01), 'long');
});

test('tính cách kể chuyện dễ nói dài hơn tính cách tối giản', () => {
    const session = {
        sceneMode: 'đối đáp thân mật',
        turn: 20,
        lastLongTurn: 0,
        recentMessages: [{}, {}, {}]
    };
    const storyteller = { personality: { longChanceBonus: 14 } };
    const minimalist = { personality: { longChanceBonus: -10 } };
    assert.equal(chooseMessageLengthMode(session, false, 0.15, storyteller), 'long');
    assert.notEqual(chooseMessageLengthMode(session, false, 0.15, minimalist), 'long');
});

test('chọn media bằng tag chủ đề mà không cần gọi Gemini', () => {
    const items = [
        { id: 'game.gif', tags: ['game', 'thua rank'] },
        { id: 'food.jpg', tags: ['đồ ăn', 'phở'] }
    ];
    assert.equal(
        selectContextualMedia(items, 'tối nay chơi game thua rank cay vl', new Set(), 0).id,
        'game.gif'
    );
    assert.equal(
        selectContextualMedia(items, 'đang nói chuyện du lịch', new Set(), 0),
        null
    );
});

test('media có cooldown và không chen vào lượt reply bắt buộc', () => {
    const session = { turn: 40, lastMediaTurn: 0 };
    const speaker = { personality: { talkWeight: 1.5 } };
    assert.equal(shouldSendMedia(session, speaker, false, true, 0), true);
    assert.equal(shouldSendMedia(session, speaker, true, true, 0), false);
    assert.equal(
        shouldSendMedia({ turn: 20, lastMediaTurn: 10 }, speaker, false, true, 0),
        false
    );
});

test('nhận diện GIF Discord/Tenor nhưng từ chối URL ngoài danh sách an toàn', () => {
    assert.deepEqual(
        extractDiscordGifCandidate({
            attachments: new Map([[
                '1',
                {
                    url: 'https://cdn.discordapp.com/attachments/1/2/reaction.gif',
                    name: 'reaction.gif',
                    contentType: 'image/gif'
                }
            ]])
        }),
        {
            url: 'https://cdn.discordapp.com/attachments/1/2/reaction.gif',
            provider: 'discord'
        }
    );
    assert.equal(
        extractDiscordGifCandidate({
            content: 'https://evil.example/private.gif'
        }),
        null
    );
});
