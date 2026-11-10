import test from 'node:test';
import assert from 'node:assert/strict';
import {
    appendContextualServerEmoji,
    buildVozThreadPageUrl,
    classifyVozPageError,
    convertVozSmilie,
    isVozCloudflareChallenge,
    parseVozForumRss,
    parseVozForumThreads,
    parseVozThreadPage,
    renderMediaFallbackLinks,
    renderVozSmiliesForDiscord,
    splitVozMessage,
    stripVozAppSignature
} from '../handlers/vozScraper.mjs';

test('404 ở trang sau kết thúc thread thay vì retry vô hạn', () => {
    assert.equal(
        classifyVozPageError({ response: { status: 404 } }, 2),
        'end-of-thread'
    );
    assert.equal(
        classifyVozPageError({ response: { status: 404 } }, 1),
        'unavailable'
    );
    assert.equal(
        classifyVozPageError({ response: { status: 503 } }, 2),
        'retry'
    );
});

test('ẩn URL media đã đính kèm và chỉ giữ link dự phòng', () => {
    const media = [
        { url: 'https://i.imgur.com/animation.gif', kind: 'image' },
        { url: 'https://voz.vn/attachments/photo.1/', kind: 'image' }
    ];

    assert.deepEqual(
        renderMediaFallbackLinks(media, ['https://i.imgur.com/animation.gif']),
        ['📎 https://voz.vn/attachments/photo.1/']
    );
    assert.deepEqual(
        renderMediaFallbackLinks(media, media.map(item => item.url)),
        []
    );
});

test('xóa chữ ký tự động của ứng dụng theNEXTvoz', () => {
    assert.equal(
        stripVozAppSignature(
            'kế toán mai fen\n\nvia theNEXTvoz (https://itunes.apple.com/app/id1502880296) for iPhone'
        ),
        'kế toán mai fen'
    );
    assert.equal(
        stripVozAppSignature('nội dung bình thường\nvia người dùng khác'),
        'nội dung bình thường\nvia người dùng khác'
    );
});

test('đổi shortcode biểu cảm VOZ phổ biến thành emoji Discord đọc được', () => {
    assert.equal(convertVozSmilie(':amazed:'), '😲');
    assert.equal(convertVozSmilie(':confident:'), '😎');
    assert.equal(convertVozSmilie(':sad:'), '😢');
    assert.equal(convertVozSmilie(':big_smile:'), '😄');
    assert.equal(convertVozSmilie(':ROFLMAO:'), '🤣');
    assert.equal(convertVozSmilie(':bieu_cam_moi:'), '');
});

test('ưu tiên emoji server cùng tên và chỉ dùng Unicode khi server không có', () => {
    const serverEmojis = [{ id: '123456789', name: 'shame_x2', animated: false }];
    assert.equal(
        renderVozSmiliesForDiscord('ngại quá :shame:', [':shame:'], serverEmojis),
        'ngại quá <:shame_x2:123456789>'
    );
    assert.equal(
        renderVozSmiliesForDiscord('hơi sốc :amazed:', [':amazed:'], serverEmojis),
        'hơi sốc 😲'
    );
    assert.equal(
        appendContextualServerEmoji('buồn thật', [{ id: '987654321', name: 'sad_pepe' }], 100, () => 0),
        'buồn thật <:sad_pepe:987654321>'
    );
    assert.equal(
        renderVozSmiliesForDiscord('à à :big_smile::big_smile:', []),
        'à à 😄😄'
    );
    assert.equal(
        renderVozSmiliesForDiscord('nội dung :emoji_khong_biet: còn lại', []),
        'nội dung còn lại'
    );
    assert.equal(
        renderVozSmiliesForDiscord('đã có <:shame_x2:123456789>', []),
        'đã có <:shame_x2:123456789>'
    );
});

test('không nhầm HTML XenForo hợp lệ với trang xác minh Cloudflare', () => {
    const validVozHtml = `
        <!doctype html><html id="XF"><head><title>Một bài VOZ</title></head>
        <body><script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script></body></html>`;
    const challengeHtml = `
        <!doctype html><html><head><title>Just a moment...</title>
        <meta name="robots" content="noindex,nofollow"></head>
        <body><script src="/cdn-cgi/challenge-platform/h/g/orchestrate/chl_page/v1"></script></body></html>`;

    assert.equal(isVozCloudflareChallenge(validVozHtml, 200, {}), false);
    assert.equal(isVozCloudflareChallenge(challengeHtml, 403, {}), true);
    assert.equal(isVozCloudflareChallenge(validVozHtml, 200, { 'cf-mitigated': 'challenge' }), true);
});

test('đọc được danh mục RSS công khai khi HTML danh mục bị Cloudflare chặn', () => {
    const rss = `<?xml version="1.0" encoding="utf-8"?>
        <rss xmlns:dc="http://purl.org/dc/elements/1.1/"><channel>
            <item>
                <title><![CDATA[Chuyện mới trên VOZ]]></title>
                <link>https://voz.vn/t/chuyen-moi.987/?utm_source=rss&amp;utm_medium=rss</link>
                <dc:creator><![CDATA[vozer A]]></dc:creator>
                <pubDate>Tue, 04 Aug 2026 00:00:00 +0000</pubDate>
            </item>
        </channel></rss>`;

    const threads = parseVozForumRss(rss);
    assert.equal(threads.length, 1);
    assert.equal(threads[0].threadId, '987');
    assert.equal(threads[0].url, 'https://voz.vn/t/chuyen-moi.987/');
    assert.equal(threads[0].author, 'vozer A');
});

test('đọc thread VOZ theo đúng thứ tự và nhận biết bài ghim', () => {
    const html = `
        <div class="structItemContainer-group structItemContainer-group--sticky">
            <div class="structItem structItem--thread" data-author="mod">
                <div class="structItem-title"><a href="/t/noi-quy.100/">Nội quy</a></div>
            </div>
        </div>
        <div class="structItemContainer-group">
            <div class="structItem structItem--thread" data-author="vozer A">
                <div class="structItem-title"><a href="/t/chuyen-dau-tien.200/">Chuyện đầu tiên</a></div>
                <dl class="pairs--justified"><dd>1.2K</dd></dl>
            </div>
            <div class="structItem structItem--thread" data-author="vozer B">
                <div class="structItem-title"><a href="/t/chuyen-thu-hai.201/">Chuyện thứ hai</a></div>
            </div>
        </div>`;

    const threads = parseVozForumThreads(html);
    assert.deepEqual(threads.map(item => item.threadId), ['100', '200', '201']);
    assert.equal(threads[0].sticky, true);
    assert.equal(threads[1].sticky, false);
    assert.equal(threads[1].replies, 1200);
    assert.equal(threads[2].url, 'https://voz.vn/t/chuyen-thu-hai.201/');
});

test('lấy đủ text, smilie, ảnh, video và đích reply từ trang thread VOZ', () => {
    const html = `
        <h1 class="p-title-value"><span class="label">Tâm sự</span> Một câu chuyện</h1>
        <ul class="pageNav-main">
            <li class="pageNav-page"><a>1</a></li>
            <li class="pageNav-page"><a>12</a></li>
        </ul>
        <article class="message message--post" data-author="alice" data-content="post-500">
            <article class="message-body"><div class="bbWrapper">
                Xin chào<br>đây là bài gốc
                <img class="smilie" alt=":D" src="/smilie.png">
                <img class="bbImage lazyload" data-src="/attachments/photo.99/" alt="photo.webp">
                <video><source src="https://cdn.example/video.mp4"></video>
                <a href="/attachments/clip-mp4.42/">clip.mp4</a>
                <br><br>via <a href="https://itunes.apple.com/app/id1502880296">theNEXTvoz</a> for iPhone
            </div></article>
        </article>
        <article class="message message--post" data-author="bob" data-content="post-501">
            <article class="message-body"><div class="bbWrapper">
                <blockquote class="bbCodeBlock--quote" data-source="post: 500">
                    <div>Nội dung đã trích không được lặp lại</div>
                </blockquote>
                Tôi trả lời bài trên
                <iframe src="https://www.youtube.com/embed/demo"></iframe>
            </div></article>
        </article>`;

    const parsed = parseVozThreadPage(html, 'https://voz.vn/t/mot-cau-chuyen.10/');
    assert.equal(parsed.title, 'Một câu chuyện');
    assert.equal(parsed.pageCount, 12);
    assert.equal(parsed.posts.length, 2);
    assert.match(parsed.posts[0].content, /Xin chào\nđây là bài gốc/);
    assert.match(parsed.posts[0].content, /:D/);
    assert.doesNotMatch(parsed.posts[0].content, /theNEXTvoz|itunes\.apple\.com/i);
    assert.deepEqual(parsed.posts[0].smilies, [':D']);
    assert.deepEqual(parsed.posts[0].media.map(item => item.kind), ['image', 'video', 'video']);
    assert.equal(parsed.posts[0].media[0].url, 'https://voz.vn/attachments/photo.99/');
    assert.equal(parsed.posts[1].replyToPostId, '500');
    assert.doesNotMatch(parsed.posts[1].content, /Nội dung đã trích/);
    assert.match(parsed.posts[1].content, /youtube\.com\/embed\/demo/);
});

test('tạo URL trang và chia nội dung dài mà không làm mất chữ', () => {
    assert.equal(
        buildVozThreadPageUrl('https://voz.vn/t/chuyen.123/page-4', 7),
        'https://voz.vn/t/chuyen.123/page-7'
    );
    const input = Array.from({ length: 80 }, (_, index) => `dòng-${index}`).join(' ');
    const chunks = splitVozMessage(input, 80);
    assert.ok(chunks.length > 1);
    assert.equal(chunks.join(' '), input);
    assert.ok(chunks.every(chunk => chunk.length <= 80));

    const emojiChunks = splitVozMessage(`123456789${'😀'}abc`, 10);
    assert.equal(emojiChunks.join(''), `123456789${'😀'}abc`);
    assert.ok(emojiChunks.every(chunk => !chunk.includes('\uFFFD')));
});
