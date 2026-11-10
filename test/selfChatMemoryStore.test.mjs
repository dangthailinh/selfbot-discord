import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
    analyzeInteractionTone,
    evolveRelationship,
    extractContextTags,
    relationshipLabel,
    selectLearnedGif
} from '../handlers/selfChatMemoryStore.mjs';

function makeMemoryData() {
    return {
        accounts: {
            A: { username: 'Alpha', recentMessages: [] },
            B: { username: 'Beta', recentMessages: [] }
        },
        channels: {},
        relationships: {},
        gifs: []
    };
}

test('nhận ra sắc thái tích cực, tiêu cực và cảm mến không dùng Gemini', () => {
    const tone = analyzeInteractionTone('chuẩn, m nói hay vl, t thích với nhớ m thật');
    assert.ok(tone.positive >= 2);
    assert.ok(tone.affection >= 2);
    assert.equal(analyzeInteractionTone('xàm thật, nghe bực vl').negative >= 2, true);
});

test('quan hệ và biệt danh phát triển từ từ qua nhiều tương tác', () => {
    const data = makeMemoryData();
    for (let index = 0; index < 36; index++) {
        evolveRelationship(data, {
            fromId: index % 2 === 0 ? 'A' : 'B',
            toId: index % 2 === 0 ? 'B' : 'A',
            fromName: index % 2 === 0 ? 'Alpha' : 'Beta',
            toName: index % 2 === 0 ? 'Beta' : 'Alpha',
            content: 'ừ chuẩn, ý này hay đó',
            sceneMode: 'đối đáp thân mật',
            topic: 'game'
        });
    }
    const pair = data.relationships['A|B'];
    assert.equal(relationshipLabel(pair), 'bạn thân');
    assert.ok(pair.views.A.nicknameForOther);
    assert.ok(pair.views.B.nicknameForOther);
    assert.ok(pair.memories.length <= 12);
});

test('cảm mến đặc biệt chỉ tăng khi đã thân và cặp có độ hợp', () => {
    const data = makeMemoryData();
    evolveRelationship(data, {
        fromId: 'A',
        toId: 'B',
        fromName: 'Alpha',
        toName: 'Beta',
        content: 'ý này hay',
        sceneMode: 'đối đáp thân mật'
    });
    const pair = data.relationships['A|B'];
    pair.chemistry = 99;
    pair.interactions = 25;
    pair.views.A.affinity = 35;
    pair.views.B.affinity = 35;

    for (let index = 0; index < 35; index++) {
        evolveRelationship(data, {
            fromId: index % 2 === 0 ? 'A' : 'B',
            toId: index % 2 === 0 ? 'B' : 'A',
            fromName: index % 2 === 0 ? 'Alpha' : 'Beta',
            toName: index % 2 === 0 ? 'Beta' : 'Alpha',
            content: 't nhớ với thương m, dễ thương thật',
            sceneMode: 'đối đáp thân mật'
        });
    }
    assert.ok(pair.views.A.romance >= 35);
    assert.ok(pair.views.B.romance >= 35);
    assert.match(relationshipLabel(pair), /cảm tình|người yêu/);
});

test('GIF học được được chọn lại theo từ khóa hội thoại', () => {
    const gifs = [
        { id: 'game', tags: ['game', 'rank'] },
        { id: 'food', tags: ['pho', 'mon'] }
    ];
    assert.equal(
        selectLearnedGif(gifs, 'tối nay game leo rank tiếp không', new Set(), 0).id,
        'game'
    );
    const tags = extractContextTags('game game leo rank cùng đồng đội');
    assert.equal(tags[0], 'game');
    assert.ok(tags.includes('rank'));
});

test('ký ức hội thoại được ghi bền vững qua file JSON', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'selfchat-memory-'));
    const memoryFile = path.join(directory, 'memory.json');
    process.env.SELFCHAT_MEMORY_FILE = memoryFile;
    const moduleUrl = new URL(
        `../handlers/selfChatMemoryStore.mjs?persist=${Date.now()}`,
        import.meta.url
    );
    const memory = await import(moduleUrl);

    memory.recordPersistentConversation({
        channelId: 'channel',
        speakerId: 'A',
        username: 'Alpha',
        content: 'Beta nói cũng đúng đó',
        targetId: 'B',
        targetName: 'Beta',
        topic: 'game',
        sceneMode: 'đối đáp thân mật'
    });
    await memory.flushSelfChatMemory();

    const saved = JSON.parse(fs.readFileSync(memoryFile, 'utf8'));
    assert.equal(saved.accounts.A.recentMessages.length, 1);
    assert.equal(saved.channels.channel.recentMessages.length, 1);
    assert.equal(saved.relationships['A|B'].interactions, 1);

    fs.rmSync(directory, { recursive: true, force: true });
    delete process.env.SELFCHAT_MEMORY_FILE;
});
