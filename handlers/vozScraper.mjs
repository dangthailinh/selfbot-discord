import * as cheerio from 'cheerio';
import he from 'he';

export const VOZ_BASE_URL = 'https://voz.vn';
export const VOZ_FORUM_URL = `${VOZ_BASE_URL}/f/chuyen-tro-linh-tinh.17/`;

export function isVozCloudflareChallenge(html, status = 200, headers = {}) {
    const source = String(html || '');
    const mitigated = headers?.get?.('cf-mitigated')
        ?? headers?.['cf-mitigated']
        ?? headers?.['CF-Mitigated'];
    if (String(mitigated || '').toLowerCase() === 'challenge') return true;
    if (/<title>\s*Just a moment\.\.\.\s*<\/title>/i.test(source)) return true;

    const hasChallengeShell = /\/cdn-cgi\/challenge-platform\//i.test(source)
        && /<meta[^>]+name=["']robots["'][^>]+content=["'][^"']*noindex[^"']*nofollow/i.test(source);
    const hasXenForoDocument = /<html[^>]+id=["']XF["']/i.test(source);
    return Number(status) === 403 && hasChallengeShell && !hasXenForoDocument;
}

export function classifyVozPageError(error, page = 1) {
    const status = Number(error?.response?.status ?? error?.status ?? 0);
    if (![404, 410].includes(status)) return 'retry';
    return Number(page) > 1 ? 'end-of-thread' : 'unavailable';
}

function absoluteUrl(value, baseUrl = VOZ_BASE_URL) {
    const raw = String(value || '').trim();
    if (!raw || raw.startsWith('data:') || raw.startsWith('javascript:')) return null;
    try {
        const url = new URL(raw, baseUrl);
        return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
    } catch (_) {
        return null;
    }
}

function parseThreadId(value) {
    const match = String(value || '').match(/\.(\d+)(?:\/|$)/);
    return match ? match[1] : null;
}

function normalizeWhitespace(value) {
    return he.decode(String(value || ''))
        .replace(/\r/g, '')
        .replace(/[\t ]+\n/g, '\n')
        .replace(/\n[\t ]+/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/[\t ]{2,}/g, ' ')
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
        .trim();
}

export function stripVozAppSignature(value) {
    const lines = normalizeWhitespace(value).split('\n');
    return normalizeWhitespace(lines
        .filter(line => !/^via\s+theNEXTvoz\b.*\bfor\s+(?:iPhone|iPad|Android)\s*$/i.test(line.trim()))
        .join('\n'));
}

const VOZ_SMILIE_MAP = new Map([
    [':)', '🙂'],
    [':d', '😄'],
    ['=))', '🤣'],
    [':))', '😄'],
    [':(', '☹️'],
    [':p', '😛'],
    [';)', '😉'],
    ['o_o', '🤨'],
    ['amazed', '😲'],
    ['ah', '😮'],
    ['confident', '😎'],
    ['sad', '😢'],
    ['too_sad', '😭'],
    ['shame', '🫣'],
    ['big_smile', '😄'],
    ['smile', '🙂'],
    ['roflmao', '🤣'],
    ['beauty', '😍'],
    ['byebye', '👋'],
    ['go', '👋'],
    ['beat_shot', '🤕'],
    ['beat_brick', '😠'],
    ['adore', '🥰'],
    ['sweet_kiss', '😘']
]);

export function convertVozSmilie(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const lowerRaw = raw.toLowerCase();
    const key = lowerRaw.replace(/^:+|:+$/g, '').replace(/[\s-]+/g, '_');
    const exact = VOZ_SMILIE_MAP.get(lowerRaw) || VOZ_SMILIE_MAP.get(key);
    if (exact) return exact;
    if (/rofl|lmao|laugh|lol|haha/.test(key)) return '🤣';
    if (/big_smile|grin|happy|smile/.test(key)) return '😄';
    if (/amaze|surpris|shock|wow/.test(key)) return '😲';
    if (/confident|cool|boss/.test(key)) return '😎';
    if (/too_sad|cry|tear/.test(key)) return '😭';
    if (/sad|sorrow/.test(key)) return '😢';
    if (/shame|embarrass|blush/.test(key)) return '🫣';
    if (/beauty|adore|love|kiss|sweet/.test(key)) return '🥰';
    if (/angry|mad|rage|beat|brick/.test(key)) return '😠';
    if (/bye|leave|go/.test(key)) return '👋';
    if (/think|doubt|hmm|what/.test(key)) return '🤔';
    if (/sweat|nervous/.test(key)) return '😅';
    if (/sleep|tired/.test(key)) return '😴';
    if (/wink/.test(key)) return '😉';
    if (/tongue|blep/.test(key)) return '😛';
    if (/dead|skull/.test(key)) return '💀';
    if (/facepalm/.test(key)) return '🤦';
    if (/okay|thumb|agree/.test(key)) return '👍';
    return '';
}

function normalizedEmojiName(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/^:+|:+$/g, '')
        .replace(/[^a-z0-9_]+/g, '_')
        .replace(/^_+|_+$/g, '');
}

export function formatDiscordCustomEmoji(emoji) {
    const name = String(emoji?.name || '').replace(/[^A-Za-z0-9_]/g, '');
    const id = String(emoji?.id || '').replace(/\D/g, '');
    if (!name || !id) return null;
    return `<${emoji?.animated ? 'a' : ''}:${name}:${id}>`;
}

function matchingCustomEmoji(shortcode, customEmojis) {
    const sourceName = normalizedEmojiName(shortcode);
    if (!sourceName) return null;
    const candidates = (customEmojis || []).filter(emoji => formatDiscordCustomEmoji(emoji));
    const exact = candidates.find(emoji => normalizedEmojiName(emoji.name) === sourceName);
    if (exact) return exact;
    if (sourceName.length < 3) return null;
    return candidates.find(emoji => {
        const serverName = normalizedEmojiName(emoji.name);
        return serverName.startsWith(`${sourceName}_`) || sourceName.startsWith(`${serverName}_`);
    }) || null;
}

export function renderVozSmiliesForDiscord(content, smilies = [], customEmojis = []) {
    const replacementFor = shortcode => {
        const customEmoji = matchingCustomEmoji(shortcode, customEmojis);
        return formatDiscordCustomEmoji(customEmoji) || convertVozSmilie(shortcode);
    };
    let rendered = String(content || '').replace(
        /:([A-Za-z][A-Za-z0-9_+-]{1,39}):/g,
        (shortcode, _name, offset, source) => {
            const previous = source[offset - 1];
            const beforePrevious = source[offset - 2];
            if (previous === '<' || (previous === 'a' && beforePrevious === '<')) return shortcode;
            return replacementFor(shortcode);
        }
    );
    for (const shortcode of [...new Set(smilies.map(String).filter(Boolean))]) {
        if (/^:[A-Za-z][A-Za-z0-9_+-]{1,39}:$/.test(shortcode)) continue;
        if (!rendered.includes(shortcode)) continue;
        rendered = rendered.split(shortcode).join(replacementFor(shortcode));
    }
    return rendered
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n[ \t]+/g, '\n')
        .replace(/[ \t]+([,.!?])/g, '$1')
        .trim();
}

function foldedText(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
}

export function appendContextualServerEmoji(
    content,
    customEmojis = [],
    chancePercent = 22,
    random = Math.random
) {
    const text = String(content || '').trim();
    const available = customEmojis.filter(emoji => formatDiscordCustomEmoji(emoji));
    if (!text || available.length === 0 || /<a?:[A-Za-z0-9_]+:\d+>/.test(text)) return text;
    if (random() * 100 >= Math.max(0, Math.min(100, chancePercent))) return text;

    const folded = foldedText(text);
    let namePattern = null;
    if (/buon|khoc|sad|toi nghiep|that vong/.test(folded)) namePattern = /sad|cry|tear|buon/;
    else if (/haha|vui|cuoi|hai|lol/.test(folded)) namePattern = /laugh|lol|haha|hehe|smile|grin|rofl/;
    else if (/gian|buc|cay|dien|ghet/.test(folded)) namePattern = /angry|mad|rage|cay|beat/;
    else if (/yeu|thich|dep|thuong/.test(folded)) namePattern = /love|heart|kiss|beauty|adore/;
    else if (/bat ngo|soc|that a|vai/.test(folded)) namePattern = /wow|amaze|shock|ah/;

    const contextual = namePattern
        ? available.filter(emoji => namePattern.test(normalizedEmojiName(emoji.name)))
        : [];
    const pool = contextual.length > 0 ? contextual : available;
    const selected = pool[Math.floor(random() * pool.length)];
    const markup = formatDiscordCustomEmoji(selected);
    return markup ? `${text} ${markup}` : text;
}

function parseCount(value) {
    const raw = String(value || '').trim().toLowerCase().replace(/,/g, '');
    const match = raw.match(/([\d.]+)\s*([km])?/);
    if (!match) return 0;
    const amount = Number.parseFloat(match[1]);
    if (!Number.isFinite(amount)) return 0;
    return Math.round(amount * (match[2] === 'k' ? 1000 : match[2] === 'm' ? 1000000 : 1));
}

export function parseVozForumThreads(html, baseUrl = VOZ_FORUM_URL) {
    const $ = cheerio.load(String(html || ''));
    const threads = [];
    const seen = new Set();

    $('.structItem--thread').each((_, element) => {
        const item = $(element);
        const sticky = item.closest('.structItemContainer-group--sticky').length > 0
            || item.find('.structItem-status--sticky').length > 0;
        const link = item.find('.structItem-title a[href*="/t/"]').first();
        const url = absoluteUrl(link.attr('href'), baseUrl);
        const threadId = parseThreadId(url);
        if (!url || !threadId || seen.has(threadId)) return;
        seen.add(threadId);

        threads.push({
            threadId,
            url,
            title: normalizeWhitespace(link.text()) || `Bài VOZ ${threadId}`,
            author: normalizeWhitespace(item.attr('data-author')) || null,
            replies: parseCount(item.find('.pairs--justified dd').first().text()),
            sticky
        });
    });

    return threads;
}

export function parseVozForumRss(xml, baseUrl = VOZ_FORUM_URL) {
    const $ = cheerio.load(String(xml || ''), { xmlMode: true });
    const threads = [];
    const seen = new Set();

    $('item').each((_, element) => {
        const item = $(element);
        const linkText = item.find('link').first().text() || item.find('guid').first().text();
        const url = absoluteUrl(linkText, baseUrl);
        const threadId = parseThreadId(url);
        if (!url || !threadId || seen.has(threadId)) return;
        seen.add(threadId);
        const canonical = new URL(url);
        for (const key of [...canonical.searchParams.keys()]) {
            if (key.toLowerCase().startsWith('utm_')) canonical.searchParams.delete(key);
        }
        const authorNode = item.children().filter((__, node) =>
            ['dc:creator', 'author'].includes(String(node.name || '').toLowerCase())
        ).first();
        const rawAuthor = normalizeWhitespace(authorNode.text());
        const parenthesizedAuthor = rawAuthor.match(/\(([^()]+)\)\s*$/)?.[1];

        threads.push({
            threadId,
            url: canonical.href,
            title: normalizeWhitespace(item.find('title').first().text()) || `Bài VOZ ${threadId}`,
            author: parenthesizedAuthor || rawAuthor || null,
            replies: 0,
            sticky: false,
            publishedAt: item.find('pubDate').first().text() || null
        });
    });

    return threads;
}

function pageCountFromDocument($) {
    const candidates = $('.pageNav-page a')
        .map((_, link) => Number.parseInt($(link).text().trim(), 10))
        .get()
        .filter(Number.isFinite);

    $('.pageNavSimple-el--current, .pageNav-jump--current').each((_, element) => {
        const match = $(element).text().match(/(?:of|trên)\s+(\d+)/i);
        if (match) candidates.push(Number.parseInt(match[1], 10));
    });

    return Math.max(1, ...candidates);
}

function quotedPostId(block) {
    const values = [
        block.attr('data-source'),
        block.find('[data-content-selector]').first().attr('data-content-selector'),
        block.find('a[href*="/goto/post"]').first().attr('href'),
        block.find('a[href*="#post-"]').first().attr('href')
    ];
    for (const value of values) {
        const match = String(value || '').match(/(?:post(?::|=|-)|#post-)\s*(\d+)/i);
        if (match) return match[1];
    }
    return null;
}

function mediaNameFromElement(element, url) {
    const candidate = element.attr('alt')
        || element.attr('title')
        || element.closest('[title]').attr('title');
    if (candidate) return normalizeWhitespace(candidate).slice(0, 120);
    try {
        return decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() || 'voz-media');
    } catch (_) {
        return 'voz-media';
    }
}

function collectMedia($, body, pageUrl) {
    const media = [];
    const seen = new Set();
    const add = (urlValue, kind, element) => {
        const url = absoluteUrl(urlValue, pageUrl);
        if (!url || seen.has(url)) return;
        seen.add(url);
        media.push({
            url,
            kind,
            name: mediaNameFromElement(element, url)
        });
    };

    body.find('img.bbImage').each((_, node) => {
        const image = $(node);
        add(
            image.attr('data-url')
                || image.attr('data-src')
                || image.closest('[data-src]').attr('data-src')
                || image.attr('src'),
            'image',
            image
        );
    });

    body.find('video').each((_, node) => {
        const video = $(node);
        const sources = [video.attr('src'), ...video.find('source').map((__, source) => $(source).attr('src')).get()];
        sources.forEach(source => add(source, 'video', video));
    });

    body.find('a[href]').each((_, node) => {
        const link = $(node);
        const href = link.attr('href');
        const label = `${link.attr('title') || ''} ${link.text()}`;
        const mediaHint = `${href || ''} ${label}`;
        if (
            /\.(?:png|jpe?g|gif|webp|avif|mp4|webm|mov)(?:[?#./\d-].*)?$/i.test(mediaHint)
            || /\/attachments\//i.test(String(href || ''))
        ) {
            add(href, /\.(?:mp4|webm|mov)(?:[?#./\d-].*)?$/i.test(mediaHint) ? 'video' : 'image', link);
        }
    });

    const embeds = [];
    body.find('iframe[src], .bbMediaWrapper[data-oembed-url]').each((_, node) => {
        const embed = $(node);
        if (node.tagName === 'iframe' && embed.closest('.bbMediaWrapper[data-oembed-url]').length > 0) return;
        const url = absoluteUrl(embed.attr('data-oembed-url') || embed.attr('src'), pageUrl);
        if (url && !seen.has(url)) {
            seen.add(url);
            embeds.push(url);
        }
    });

    return { media, embeds };
}

function bodyToText($, body, pageUrl) {
    const clone = body.clone();
    clone.find('script, style, noscript').remove();
    clone.find('img.smilie').each((_, node) => {
        const image = $(node);
        const shortcode = image.attr('alt') || image.attr('data-shortname') || image.attr('title') || '';
        image.replaceWith(` ${shortcode} `);
    });
    clone.find('a[href]').each((_, node) => {
        const link = $(node);
        if (link.find('img, video').length > 0) return;
        const url = absoluteUrl(link.attr('href'), pageUrl);
        const label = normalizeWhitespace(link.text());
        if (!url) return;
        link.replaceWith(label && label !== url ? `${label} (${url})` : url);
    });
    clone.find('img.bbImage, video, iframe, .bbMediaWrapper').remove();
    clone.find('br').replaceWith('\n');
    clone.find('p, li, blockquote, pre').each((_, node) => $(node).append('\n'));
    return stripVozAppSignature(clone.text());
}

export function parseVozThreadPage(html, pageUrl) {
    const $ = cheerio.load(String(html || ''));
    const titleNode = $('h1.p-title-value').first().clone();
    titleNode.find('.labelLink, .label').remove();
    const title = normalizeWhitespace(titleNode.text())
        || normalizeWhitespace($('meta[property="og:title"]').attr('content'))
        || 'Bài viết VOZ';
    const posts = [];

    $('article.message--post').each((_, element) => {
        const article = $(element);
        const postId = String(article.attr('data-content') || article.attr('id') || '').match(/post-(\d+)/)?.[1];
        const originalBody = article.find('.message-body .bbWrapper').first();
        if (!postId || originalBody.length === 0) return;

        const body = originalBody.clone();
        let replyToPostId = null;
        body.find('.bbCodeBlock--quote').each((__, quoteNode) => {
            if (!replyToPostId) replyToPostId = quotedPostId($(quoteNode));
            $(quoteNode).remove();
        });
        const { media, embeds } = collectMedia($, body, pageUrl);
        const smilies = body.find('img.smilie')
            .map((__, node) => {
                const image = $(node);
                return image.attr('alt') || image.attr('data-shortname') || image.attr('title') || null;
            })
            .get()
            .filter(Boolean);
        let content = bodyToText($, body, pageUrl);
        if (embeds.length > 0) {
            content = normalizeWhitespace([content, ...embeds.map(url => `🎬 ${url}`)].filter(Boolean).join('\n'));
        }
        if (!content && media.length === 0) return;

        posts.push({
            postId,
            author: normalizeWhitespace(article.attr('data-author')) || 'Vozer',
            content,
            replyToPostId,
            media,
            smilies,
            timestamp: Number.parseInt(article.find('time[data-time]').first().attr('data-time') || '', 10) || null
        });
    });

    return {
        title,
        pageCount: pageCountFromDocument($),
        posts
    };
}

export function buildVozThreadPageUrl(threadUrl, page) {
    const url = new URL(threadUrl, VOZ_BASE_URL);
    url.pathname = url.pathname.replace(/\/page-\d+\/?$/i, '/');
    if (!url.pathname.endsWith('/')) url.pathname += '/';
    if (Number(page) > 1) url.pathname += `page-${Number(page)}`;
    return url.href;
}

export function splitVozMessage(value, maxLength = 1900) {
    let remaining = String(value || '').trim();
    const chunks = [];
    while (remaining.length > maxLength) {
        let splitAt = remaining.lastIndexOf('\n', maxLength);
        if (splitAt < Math.floor(maxLength * 0.45)) splitAt = remaining.lastIndexOf(' ', maxLength);
        if (splitAt < Math.floor(maxLength * 0.45)) splitAt = maxLength;
        const previousCodeUnit = remaining.charCodeAt(splitAt - 1);
        if (previousCodeUnit >= 0xD800 && previousCodeUnit <= 0xDBFF) splitAt -= 1;
        chunks.push(remaining.slice(0, splitAt).trim());
        remaining = remaining.slice(splitAt).trimStart();
    }
    if (remaining) chunks.push(remaining);
    return chunks;
}

export function renderMediaFallbackLinks(media = [], attachedUrls = []) {
    const attached = new Set([...attachedUrls].map(String));
    return media
        .filter(item => item?.url && !attached.has(String(item.url)))
        .map(item => `📎 ${item.url}`);
}
