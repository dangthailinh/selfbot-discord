import test from 'node:test';
import assert from 'node:assert/strict';
import {
    claimChannelActivity,
    getChannelActivity,
    releaseChannelActivity
} from '../handlers/channelActivityStore.mjs';
import {
    isGuildFileUploadLimitedError,
    sendWithUploadFallback
} from '../handlers/debateSendPolicy.mjs';

test('nhận diện chính xác lỗi Discord giới hạn upload của guild', () => {
    assert.equal(
        isGuildFileUploadLimitedError(
            new Error('Access to file uploads has been limited for this guild')
        ),
        true
    );
    assert.equal(isGuildFileUploadLimitedError(new Error('Missing Access')), false);
});

test('selfchat và debate không thể chiếm cùng một kênh', () => {
    const channelId = 'debate-isolation-test';
    releaseChannelActivity(channelId);

    assert.equal(claimChannelActivity(channelId, 'selfchat'), true);
    assert.equal(claimChannelActivity(channelId, 'debate'), false);
    assert.equal(getChannelActivity(channelId).mode, 'selfchat');

    assert.equal(releaseChannelActivity(channelId, 'selfchat'), true);
    assert.equal(claimChannelActivity(channelId, 'debate'), true);
    assert.equal(releaseChannelActivity(channelId, 'debate'), true);
});

test('upload bị giới hạn sẽ gửi lại đúng một lần bằng văn bản', async () => {
    const payloads = [];
    const channel = {
        send: async payload => {
            payloads.push(payload);
            if (payloads.length === 1) {
                throw new Error('Access to file uploads has been limited for this guild');
            }
            return { id: 'text-message' };
        }
    };

    const result = await sendWithUploadFallback(channel, {
        content: 'Nội dung bài 4chan',
        files: [{ attachment: Buffer.from('media'), name: 'media.png' }],
        allowedMentions: { parse: [] }
    });

    assert.equal(result.message.id, 'text-message');
    assert.equal(result.uploadLimited, true);
    assert.equal(result.mediaSkipped, false);
    assert.equal(payloads.length, 2);
    assert.equal('files' in payloads[1], false);
    assert.equal(payloads[1].content, 'Nội dung bài 4chan');
});

test('bài chỉ có media được bỏ qua sau một lỗi upload', async () => {
    let calls = 0;
    const result = await sendWithUploadFallback({
        send: async () => {
            calls += 1;
            throw new Error('Access to file uploads has been limited for this guild');
        }
    }, {
        files: [{ attachment: Buffer.from('media'), name: 'media.png' }]
    });

    assert.equal(calls, 1);
    assert.equal(result.mediaSkipped, true);
    assert.equal(result.message, null);
});
