import test from 'node:test';
import assert from 'node:assert/strict';
import { findRoleplayParticipants } from '../handlers/roleplayParticipants.mjs';
import {
    chooseSpeaker,
    getSelfChatStatus,
    handleSelfChatCommand
} from '../handlers/selfChatHandler.mjs';

function makeClient(id, channelId, permissions = ['VIEW_CHANNEL', 'SEND_MESSAGES']) {
    const channel = {
        send: async () => {},
        permissionsFor: () => ({ has: flags => flags.every(flag => permissions.includes(flag)) })
    };
    return {
        user: { id, username: `account-${id}` },
        channels: {
            cache: new Map([[channelId, channel]]),
            fetch: async () => { throw new Error('Missing Access'); }
        },
        isReady: () => true
    };
}

test('exactly two channel accounts participate even when fourteen others are outside the server', async () => {
    const clients = Array.from({ length: 16 }, (_, i) => makeClient(String(i), i < 2 ? 'target' : 'other'));
    const participants = await findRoleplayParticipants(clients, 'target');
    assert.deepEqual(participants.map(item => item.client.user.id), ['0', '1']);
});

test('exclude accounts without view/send permission, disconnected accounts and duplicate users', async () => {
    const first = makeClient('first', 'target');
    const offline = makeClient('offline', 'target');
    offline.isReady = () => false;
    const clients = [
        first, first, makeClient('read-only', 'target', ['VIEW_CHANNEL']),
        makeClient('hidden', 'target', ['SEND_MESSAGES']), offline, {}
    ];
    assert.deepEqual((await findRoleplayParticipants(clients, 'target')).map(item => item.client.user.id), ['first']);
});

test('fetch uncached channels and apply the thread-specific send permission', async () => {
    const client = makeClient('thread-user', 'target', ['VIEW_CHANNEL', 'SEND_MESSAGES_IN_THREADS']);
    const channel = client.channels.cache.get('target');
    channel.isThread = () => true;
    client.channels.cache.clear();
    client.channels.fetch = async () => channel;
    assert.equal((await findRoleplayParticipants([client], 'target')).length, 1);
    channel.sendable = false;
    assert.equal((await findRoleplayParticipants([client], 'target')).length, 0);
});

test('two roleplay speakers alternate without waiting for other configured accounts', () => {
    const participants = ['a', 'b'].map(id => ({ client: { user: { id } }, turns: 0 }));
    const session = { participants, lastSpeakerId: null, activeParticipantIds: new Set(['a', 'b']) };
    for (let turn = 0; turn < 20; turn++) {
        const speaker = chooseSpeaker(session);
        assert.notEqual(speaker.client.user.id, session.lastSpeakerId);
        speaker.turns++;
        session.lastSpeakerId = speaker.client.user.id;
    }
    assert.deepEqual(participants.map(item => item.turns), [10, 10]);
});

for (const writableCount of [1, 2, 3]) {
    test(`selfchat startup with ${writableCount} writable accounts and others unavailable`, async () => {
        const channelId = `roleplay-startup-${writableCount}`;
        const clients = Array.from({ length: 5 }, (_, i) => makeClient(
            String(i), i === 4 ? 'outside' : channelId,
            i < writableCount ? ['VIEW_CHANNEL', 'SEND_MESSAGES'] : ['VIEW_CHANNEL']
        ));
        const notices = [];
        let startupStatus;
        const message = {
            id: `${channelId}-start`, content: '!selfchat', author: clients[0].user,
            channel: { id: channelId, send: async ({ content }) => {
                notices.push(content);
                if (content.startsWith('💬 Selfchat đã kết nối')) {
                    startupStatus = getSelfChatStatus(channelId);
                    // Stop before the background loop sends anything or calls an AI service.
                    await handleSelfChatCommand({ ...message, id: `${channelId}-end`, content: '!selfchatend' }, clients);
                }
            } }
        };
        await handleSelfChatCommand(message, clients);
        if (writableCount < 2) {
            assert.match(notices[0], /Cần ít nhất 2 tài khoản/);
            assert.equal(startupStatus, undefined);
        } else {
            assert.equal(startupStatus.participants, writableCount);
            assert.equal(startupStatus.active, true);
            assert.ok(startupStatus.activeParticipants >= 2);
        }
        assert.equal(getSelfChatStatus(channelId), null);
    });
}
