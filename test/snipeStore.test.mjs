import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('nhiều tài khoản không ghi trùng và không tranh chấp file snipe', async () => {
    const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'selfbot-snipe-'));
    const storePath = path.join(tempDirectory, 'deleted_messages.json');
    process.env.DELETED_MESSAGES_FILE = storePath;

    const moduleUrl = new URL(`../commands/snipe.mjs?test=${Date.now()}`, import.meta.url);
    const { addDeletedMessage, flushDeletedMessages } = await import(moduleUrl);
    const makeMessage = id => ({
        id,
        content: `message ${id}`,
        author: { id: 'author-1', tag: 'tester#0001', username: 'tester' },
        channel: { id: 'channel-1' },
        attachments: new Map()
    });

    for (let index = 0; index < 40; index++) {
        const message = makeMessage(`message-${index}`);
        addDeletedMessage(message);
        addDeletedMessage(message);
    }
    await flushDeletedMessages();

    const saved = JSON.parse(fs.readFileSync(storePath, 'utf8'));
    assert.equal(saved['channel-1'].length, 10);
    assert.equal(new Set(saved['channel-1'].map(item => item.id)).size, 10);

    addDeletedMessage(makeMessage('message-new'));
    await flushDeletedMessages();
    const replaced = JSON.parse(fs.readFileSync(storePath, 'utf8'));
    assert.equal(replaced['channel-1'][0].id, 'message-new');
    assert.equal(replaced['channel-1'].length, 10);

    fs.rmSync(tempDirectory, { recursive: true, force: true });
    delete process.env.DELETED_MESSAGES_FILE;
});
