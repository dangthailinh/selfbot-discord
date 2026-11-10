import test from 'node:test';
import assert from 'node:assert/strict';
import { execute } from '../commands/debatecpt.mjs';
import { registerDebateRoster, excludeDebateAccount, guardDebateChannel } from '../handlers/debateRoster.mjs';
import { sendWithUploadFallback } from '../handlers/debateSendPolicy.mjs';

for (const mode of ['debate', 'debatevoz']) {
    test(`${mode}: debatecpt excludes only the command author and leaves two accounts running`, async () => {
        const channelId = `cpt-${mode}`;
        let stopped = false;
        const roster = registerDebateRoster(channelId, mode, ['a', 'b', 'c'], () => { stopped = true; });
        try {
            const response = await execute(
                { channel: { id: channelId }, author: { id: 'a' } }, ['b'], { user: { id: 'a' } }
            );
            assert.match(response, /Còn 2 tài khoản/);
            assert.equal(roster.has('a'), false);
            assert.equal(roster.has('b'), true);
            assert.equal(roster.has('c'), true);
            assert.equal(stopped, false);
            assert.match(await execute(
                { channel: { id: channelId }, author: { id: 'a' } }, [], { user: { id: 'a' } }
            ), /không tham gia/);
        } finally { roster.close(); }
    });

    test(`${mode}: removing one of two accounts stops the session and permits a fresh start`, async () => {
        const channelId = `cpt-stop-${mode}`;
        let stops = 0;
        const roster = registerDebateRoster(channelId, mode, ['a', 'b'], () => { stops++; });
        const response = await execute(
            { channel: { id: channelId }, author: { id: 'a' } }, [], { user: { id: 'a' } }
        );
        assert.match(response, /dừng vì còn dưới 2 tài khoản/);
        assert.equal(stops, 1);
        assert.equal(roster.has('b'), false);
        assert.equal(excludeDebateAccount(channelId, 'a').status, 'inactive');
        const next = registerDebateRoster(channelId, mode, ['a', 'b'], () => {});
        roster.close(); // A stale cleanup must not erase the new session.
        assert.equal(excludeDebateAccount(channelId, 'other').status, 'not-participant');
        next.close();
    });
}

test('cpt rejects a different author and does not affect other channels', async () => {
    const first = registerDebateRoster('cpt-isolation-a', 'debate', ['a', 'b', 'c'], () => {});
    const other = registerDebateRoster('cpt-isolation-b', 'debatevoz', ['a', 'b', 'c'], () => {});
    try {
        const response = await execute(
            { channel: { id: 'cpt-isolation-a' }, author: { id: 'b' } }, [], { user: { id: 'a' } }
        );
        assert.match(response, /chính tài khoản/);
        assert.equal(first.has('b'), true);
        excludeDebateAccount('cpt-isolation-a', 'a');
        assert.equal(other.has('a'), true);
    } finally { first.close(); other.close(); }
});

test('no active debate returns an informative command response', async () => {
    assert.match(await execute(
        { channel: { id: 'cpt-inactive' }, author: { id: 'a' } }, [], { user: { id: 'a' } }
    ), /chưa có phiên/);
});

test('excluded accounts cannot send remaining chunks or upload fallbacks', async () => {
    const channelId = 'cpt-send-guard';
    const roster = registerDebateRoster(channelId, 'debate', ['a', 'b', 'c'], () => {});
    let calls = 0;
    const guarded = guardDebateChannel({ send: async () => {
        calls++;
        excludeDebateAccount(channelId, 'a');
        throw new Error('Access to file uploads has been limited for this guild');
    } }, roster, 'a');
    try {
        await assert.rejects(sendWithUploadFallback(guarded, {
            content: 'post', files: [{ name: 'photo.png' }]
        }), { code: 'DEBATE_ACCOUNT_EXCLUDED' });
        assert.throws(() => guarded.send({ content: 'next chunk' }), { code: 'DEBATE_ACCOUNT_EXCLUDED' });
        assert.equal(calls, 1);
    } finally { roster.close(); }
});
