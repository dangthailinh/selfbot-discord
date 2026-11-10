import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('cấu hình có đủ 29 tính cách với mức hoạt động khác nhau', () => {
    const config = JSON.parse(
        fs.readFileSync(new URL('../gemini-personalities.json', import.meta.url), 'utf8')
    );
    const names = config.defaults.map(item => item.name);
    const talkWeights = config.defaults.map(item => item.talkWeight);

    assert.equal(config.groupIdentity, "i'm just a bot");
    assert.equal(config.defaults.length, 29);
    assert.equal(new Set(names).size, 29);
    assert.ok(Math.max(...talkWeights) >= 1.7);
    assert.ok(Math.min(...talkWeights) <= 0.4);
});
