import axios from 'axios';
import dns from 'node:dns/promises';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { clients } from '../index.mjs';
import {
    claimChannelActivity,
    getChannelActivity,
    releaseChannelActivity
} from '../handlers/channelActivityStore.mjs';
import { sendWithUploadFallback } from '../handlers/debateSendPolicy.mjs';
import { findRoleplayParticipants } from '../handlers/roleplayParticipants.mjs';
import { registerDebateRoster, guardDebateChannel } from '../handlers/debateRoster.mjs';
import {
    appendContextualServerEmoji,
    buildVozThreadPageUrl,
    classifyVozPageError,
    isVozCloudflareChallenge,
    parseVozForumRss,
    parseVozForumThreads,
    parseVozThreadPage,
    renderMediaFallbackLinks,
    renderVozSmiliesForDiscord,
    splitVozMessage,
    VOZ_FORUM_URL
} from '../handlers/vozScraper.mjs';

export const name = 'debatevoz';
export const description = 'Relay tuần tự toàn bộ bài trong VOZ Chuyện trò linh tinh';
export const permission = 'everyone';

const STATE_FILE = process.env.DEBATEVOZ_STATE_FILE
    ? path.resolve(process.env.DEBATEVOZ_STATE_FILE)
    : path.join(process.cwd(), 'usedVozThreads.json');
const MODE = 'debatevoz';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36 DiscordVozRelay/1.0';
const CONTENT_TYPE_EXTENSIONS = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/avif': '.avif',
    'video/mp4': '.mp4',
    'video/webm': '.webm',
    'video/quicktime': '.mov'
};
const CONTEXT_EMOJIS = {
    positive: ['👍', '😂', '❤️', '🔥', '💯', '👏'],
    negative: ['😢', '😡', '👎', '💀', '😬'],
    question: ['🤔', '❓', '🧐'],
    neutral: ['😮', '👀', '🙂', '🙃']
};

let activeSession = null;

function readInteger(name, fallback, min, max) {
    const parsed = Number.parseInt(process.env[name] || '', 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
}

function waitForSession(session, delay) {
    return new Promise(resolve => {
        const timer = setTimeout(resolve, Math.max(0, delay));
        session.wake = () => {
            clearTimeout(timer);
            session.wake = null;
            resolve();
        };
    });
}

function defaultState() {
    return {
        version: 1,
        usedThreadIds: [],
        usedThreads: [],
        catalogPageCursor: 2,
        active: null,
        updatedAt: null
    };
}

async function loadState() {
    try {
        const parsed = JSON.parse(await fs.readFile(STATE_FILE, 'utf8'));
        return {
            ...defaultState(),
            ...parsed,
            usedThreadIds: Array.isArray(parsed?.usedThreadIds)
                ? parsed.usedThreadIds.map(String)
                : [],
            usedThreads: Array.isArray(parsed?.usedThreads) ? parsed.usedThreads : []
        };
    } catch (error) {
        if (error?.code !== 'ENOENT') {
            console.warn(`[DEBATEVOZ] Không đọc được tiến độ: ${error.message}`);
        }
        return defaultState();
    }
}

async function saveState(state) {
    state.updatedAt = new Date().toISOString();
    const temporaryFile = `${STATE_FILE}.tmp`;
    const serialized = JSON.stringify(state, null, 2);
    await fs.writeFile(temporaryFile, serialized, 'utf8');
    try {
        await fs.rename(temporaryFile, STATE_FILE);
    } catch (_) {
        await fs.writeFile(STATE_FILE, serialized, 'utf8');
        await fs.unlink(temporaryFile).catch(() => {});
    }
}

function isRetryableRequest(error) {
    const status = Number(error?.response?.status || 0);
    return status === 408 || status === 425 || status === 429 || status >= 500
        || ['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ENOTFOUND'].includes(error?.code);
}

async function requestHtml(url, attempts = 3) {
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
            const response = await axios.get(url, {
                timeout: readInteger('DEBATEVOZ_REQUEST_TIMEOUT_MS', 25000, 5000, 60000),
                validateStatus: () => true,
                headers: {
                    'User-Agent': USER_AGENT,
                    Accept: 'text/html,application/xhtml+xml',
                    'Accept-Language': 'vi,en;q=0.8'
                }
            });
            const html = String(response.data || '');
            if (isVozCloudflareChallenge(html, response.status, response.headers)) {
                const error = new Error('VOZ đang yêu cầu xác minh Cloudflare; sẽ thử lại sau.');
                error.code = 'VOZ_CLOUDFLARE';
                throw error;
            }
            if (response.status < 200 || response.status >= 300) {
                const error = new Error(`VOZ trả HTTP ${response.status} cho ${url}`);
                error.response = response;
                throw error;
            }
            return html;
        } catch (error) {
            lastError = error;
            if (attempt >= attempts || (!isRetryableRequest(error) && error?.code !== 'VOZ_CLOUDFLARE')) break;
            await new Promise(resolve => setTimeout(resolve, 1500 * (2 ** (attempt - 1))));
        }
    }
    throw lastError;
}

async function fetchChannel(client, channelId) {
    const cached = client?.channels?.cache?.get?.(channelId);
    if (cached) return cached;
    return client?.channels?.fetch ? client.channels.fetch(channelId).catch(() => null) : null;
}

async function findParticipants(channelId) {
    return findRoleplayParticipants(clients, channelId);
}

function participantCandidates(session, excludedIds = new Set()) {
    const available = session.participants.filter(item =>
        session.roster.has(item.client.user.id) && !session.failedClientIds.has(item.client.user.id));
    const preferred = available.filter(item => !excludedIds.has(item.client.user.id));
    return (preferred.length > 0 ? preferred : available)
        .map(item => ({
            ...item,
            sent: session.sendCounts.get(item.client.user.id) || 0,
            tie: Math.random()
        }))
        .sort((left, right) => left.sent - right.sent || left.tie - right.tie);
}

async function sendNotice(session, content) {
    for (const participant of participantCandidates(session)) {
        try {
            return await guardDebateChannel(participant.channel, session.roster, participant.client.user.id).send({
                content,
                allowedMentions: { parse: [] }
            });
        } catch (_) {}
    }
    return null;
}

function isPrivateIp(address) {
    if (net.isIPv4(address)) {
        const parts = address.split('.').map(Number);
        return parts[0] === 10
            || parts[0] === 127
            || parts[0] === 0
            || (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127)
            || (parts[0] === 169 && parts[1] === 254)
            || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
            || (parts[0] === 192 && parts[1] === 0)
            || (parts[0] === 192 && parts[1] === 168)
            || (parts[0] === 198 && [18, 19].includes(parts[1]))
            || (parts[0] === 198 && parts[1] === 51 && parts[2] === 100)
            || (parts[0] === 203 && parts[1] === 0 && parts[2] === 113)
            || (parts[0] >= 224);
    }
    if (net.isIPv6(address)) {
        const normalized = address.toLowerCase();
        if (normalized.startsWith('::ffff:')) return isPrivateIp(normalized.slice(7));
        return normalized === '::1'
            || normalized === '::'
            || normalized.startsWith('fc')
            || normalized.startsWith('fd')
            || normalized.startsWith('fe8')
            || normalized.startsWith('fe9')
            || normalized.startsWith('fea')
            || normalized.startsWith('feb');
    }
    return true;
}

async function assertPublicMediaUrl(value) {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Giao thức media không an toàn.');
    if (['localhost', 'localhost.localdomain'].includes(url.hostname.toLowerCase())) {
        throw new Error('Host media nội bộ bị từ chối.');
    }
    const addresses = await dns.lookup(url.hostname, { all: true });
    if (addresses.length === 0 || addresses.some(item => isPrivateIp(item.address))) {
        throw new Error('Địa chỉ media nội bộ bị từ chối.');
    }
    return url;
}

function safeFilename(value, contentType, index) {
    let filename = String(value || '').split(/[?#]/)[0].split('/').pop() || `voz-media-${index}`;
    try {
        filename = decodeURIComponent(filename);
    } catch (_) {}
    filename = filename.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').slice(0, 100) || `voz-media-${index}`;
    if (!path.extname(filename) && CONTENT_TYPE_EXTENSIONS[contentType]) {
        filename += CONTENT_TYPE_EXTENSIONS[contentType];
    }
    return filename;
}

async function downloadMedia(media, index) {
    const maxBytes = readInteger('DEBATEVOZ_MEDIA_MAX_BYTES', 8_000_000, 100_000, 25_000_000);
    let url = await assertPublicMediaUrl(media.url);

    for (let redirect = 0; redirect <= 4; redirect += 1) {
        const response = await axios.get(url.href, {
            responseType: 'arraybuffer',
            timeout: readInteger('DEBATEVOZ_MEDIA_TIMEOUT_MS', 30000, 5000, 90000),
            maxRedirects: 0,
            maxContentLength: maxBytes,
            maxBodyLength: maxBytes,
            validateStatus: status => status >= 200 && status < 400,
            headers: {
                'User-Agent': USER_AGENT,
                Referer: 'https://voz.vn/'
            }
        });
        if (response.status >= 300) {
            const location = response.headers.location;
            if (!location || redirect === 4) throw new Error('Media chuyển hướng quá nhiều lần.');
            url = await assertPublicMediaUrl(new URL(location, url).href);
            continue;
        }

        let contentType = String(response.headers['content-type'] || '').split(';')[0].toLowerCase();
        if (!contentType.startsWith('image/') && !contentType.startsWith('video/')) {
            const extension = path.extname(media.name || url.pathname).toLowerCase();
            const inferredType = Object.entries(CONTENT_TYPE_EXTENSIONS)
                .find(([, knownExtension]) => knownExtension === extension)?.[0];
            if (!inferredType) {
                throw new Error(`Định dạng media không được hỗ trợ: ${contentType || 'không rõ'}`);
            }
            contentType = inferredType;
        }
        const buffer = Buffer.from(response.data);
        if (buffer.length === 0 || buffer.length > maxBytes) throw new Error('Media rỗng hoặc quá dung lượng.');
        return {
            attachment: buffer,
            name: safeFilename(media.name || url.pathname, contentType, index)
        };
    }
    throw new Error('Không tải được media.');
}

async function prepareMedia(session, post) {
    const limit = readInteger('DEBATEVOZ_MAX_MEDIA_PER_POST', 6, 1, 10);
    const files = [];
    const uploadedMedia = [];
    if (session.mediaUploadsBlocked) return { files, uploadedMedia };
    for (const [index, media] of post.media.slice(0, limit).entries()) {
        if (session.stopRequested || session.skipRequested) break;
        try {
            files.push(await downloadMedia(media, index + 1));
            uploadedMedia.push(media);
        } catch (error) {
            console.warn(`[DEBATEVOZ] Không tải được ${media.url}: ${error.message}`);
        }
    }
    return { files, uploadedMedia };
}

function emojiForContent(content) {
    const text = String(content || '').toLowerCase();
    let pool = CONTEXT_EMOJIS.neutral;
    if (/\?|hỏi|sao|tại sao|thế nào|ai biết/.test(text)) pool = CONTEXT_EMOJIS.question;
    else if (/hay|đẹp|tốt|vui|cười|haha|ưng|chuẩn|tuyệt|yêu/.test(text)) pool = CONTEXT_EMOJIS.positive;
    else if (/buồn|tệ|ghét|bực|cay|chán|khóc|toang|lỗi/.test(text)) pool = CONTEXT_EMOJIS.negative;
    return pool[Math.floor(Math.random() * pool.length)];
}

function usableGuildEmojis(participant) {
    const guild = participant.channel.guild;
    const member = guild?.members?.cache?.get?.(participant.client.user.id);
    return [...(guild?.emojis?.cache?.values?.() || [])].filter(emoji => {
        if (!emoji?.id || !emoji?.name || emoji.available === false) return false;
        const restrictedRoles = [...(emoji.roles?.cache?.keys?.() || [])];
        if (restrictedRoles.length === 0) return true;
        if (!member) return false;
        return restrictedRoles.some(roleId => member.roles?.cache?.has?.(roleId));
    });
}

async function addReactions(session, senderId, messageId, content) {
    const chance = readInteger('DEBATEVOZ_REACTION_CHANCE_PERCENT', 55, 0, 100);
    if (Math.random() * 100 >= chance) return;
    const maximum = readInteger('DEBATEVOZ_MAX_REACTIONS_PER_POST', 2, 1, 4);
    const reactors = session.participants
        .filter(item => session.roster.has(item.client.user.id))
        .filter(item => item.client.user.id !== senderId)
        .sort(() => Math.random() - 0.5)
        .slice(0, 1 + Math.floor(Math.random() * maximum));

    for (const reactor of reactors) {
        try {
            const message = await reactor.channel.messages.fetch(messageId);
            const customEmojis = usableGuildEmojis(reactor);
            const useCustom = customEmojis.length > 0 && Math.random() < 0.3;
            const emoji = useCustom
                ? customEmojis[Math.floor(Math.random() * customEmojis.length)].id
                : emojiForContent(content);
            if (session.roster.has(reactor.client.user.id)) await message.react(emoji);
        } catch (_) {}
    }
}

async function sendPost(session, post, replyTarget) {
    const { files, uploadedMedia } = await prepareMedia(session, post);
    const mediaLinks = renderMediaFallbackLinks(
        post.media,
        uploadedMedia.map(item => item.url)
    );
    if (session.stopRequested || session.skipRequested) return null;
    if (!post.content && mediaLinks.length === 0 && files.length === 0) return null;

    const excluded = new Set([
        session.previousSenderId,
        replyTarget?.senderId
    ].filter(Boolean));
    const sourceAuthor = String(post.author || 'Vozer').trim().toLowerCase();
    const assignedClientId = session.authorAssignments.get(sourceAuthor);
    let candidates = participantCandidates(session, assignedClientId ? new Set() : excluded);
    if (assignedClientId) {
        candidates = candidates.sort((left, right) =>
            Number(right.client.user.id === assignedClientId)
            - Number(left.client.user.id === assignedClientId)
        );
    } else if (candidates[0]) {
        session.authorAssignments.set(sourceAuthor, candidates[0].client.user.id);
    }

    for (const participant of candidates) {
        if (!session.roster.has(participant.client.user.id)) continue;
        const sendChannel = guardDebateChannel(participant.channel, session.roster, participant.client.user.id);
        const customEmojis = usableGuildEmojis(participant);
        const renderedBody = renderVozSmiliesForDiscord(post.content, post.smilies, customEmojis);
        const decoratedBody = appendContextualServerEmoji(
            renderedBody,
            customEmojis,
            readInteger('DEBATEVOZ_INLINE_EMOJI_CHANCE_PERCENT', 22, 0, 70)
        );
        const completeText = [decoratedBody, ...mediaLinks].filter(Boolean).join('\n');
        const chunks = splitVozMessage(completeText);
        if (chunks.length === 0 && files.length === 0) continue;
        const firstPayload = {
            allowedMentions: { parse: [], repliedUser: false }
        };
        if (chunks[0]) firstPayload.content = chunks[0];
        if (files.length > 0) firstPayload.files = files;
        if (replyTarget?.messageId) {
            firstPayload.reply = {
                messageReference: replyTarget.messageId,
                failIfNotExists: false
            };
        }

        try {
            const firstResult = await sendWithUploadFallback(sendChannel, firstPayload);
            if (firstResult.uploadLimited) session.mediaUploadsBlocked = true;
            let firstMessage = firstResult.message;

            if (firstResult.uploadLimited && uploadedMedia.length > 0) {
                const uploadFallbackChunks = splitVozMessage(
                    renderMediaFallbackLinks(uploadedMedia).join('\n')
                );
                for (const chunk of uploadFallbackChunks) {
                    const fallbackMessage = await sendChannel.send({
                        content: chunk,
                        allowedMentions: { parse: [] }
                    });
                    if (!firstMessage) firstMessage = fallbackMessage;
                }
            }

            if (!firstMessage) continue;

            for (const chunk of chunks.slice(1)) {
                await sendChannel.send({
                    content: chunk,
                    allowedMentions: { parse: [] }
                });
            }
            const senderId = participant.client.user.id;
            session.sendCounts.set(senderId, (session.sendCounts.get(senderId) || 0) + 1);
            session.previousSenderId = senderId;
            session.authorAssignments.set(sourceAuthor, senderId);
            session.failedClientIds.clear();
            await addReactions(session, senderId, firstMessage.id, completeText);
            return {
                messageId: firstMessage.id,
                senderId
            };
        } catch (error) {
            console.warn(`[DEBATEVOZ] ${participant.client.user.username} gửi lỗi: ${error.message}`);
            session.failedClientIds.add(participant.client.user.id);
        }
    }
    session.failedClientIds.clear();
    return null;
}

async function nextUnusedThread(state, session) {
    const used = new Set(state.usedThreadIds.map(String));
    const pagesPerScan = readInteger('DEBATEVOZ_CATALOG_PAGES', 5, 1, 50);
    const requestDelay = readInteger('DEBATEVOZ_REQUEST_DELAY_MS', 1400, 700, 10000);
    const cursor = Math.max(2, Number(state.catalogPageCursor) || 2);
    const pages = [1];
    for (let offset = 0; pages.length < pagesPerScan; offset += 1) {
        pages.push(cursor + offset);
    }

    for (const [index, page] of pages.entries()) {
        if (session.stopRequested) return null;
        const url = page === 1 ? VOZ_FORUM_URL : `${VOZ_FORUM_URL}page-${page}`;
        let threads;
        const useRss = page === 1 && session.catalogRssUntil > Date.now();
        if (useRss) {
            const rssUrl = `${VOZ_FORUM_URL}index.rss`;
            threads = parseVozForumRss(await requestHtml(rssUrl), rssUrl);
        } else {
            try {
                threads = parseVozForumThreads(await requestHtml(url), url);
            } catch (error) {
                if (page !== 1 || error?.code !== 'VOZ_CLOUDFLARE') throw error;
                const fallbackMs = readInteger(
                    'DEBATEVOZ_RSS_FALLBACK_MS',
                    30 * 60 * 1000,
                    60000,
                    24 * 60 * 60 * 1000
                );
                session.catalogRssUntil = Date.now() + fallbackMs;
                console.warn('[DEBATEVOZ] Danh mục HTML bị Cloudflare chặn; tạm dùng RSS công khai của VOZ.');
                const rssUrl = `${VOZ_FORUM_URL}index.rss`;
                threads = parseVozForumRss(await requestHtml(rssUrl), rssUrl);
            }
        }
        threads = threads
            .filter(thread => !thread.sticky && !used.has(thread.threadId));
        if (threads.length > 0) {
            if (page > 1) state.catalogPageCursor = page;
            return threads[0];
        }
        if (index < pages.length - 1) await waitForSession(session, requestDelay);
    }
    if (pagesPerScan > 1) state.catalogPageCursor = cursor + pagesPerScan - 1;
    await saveState(state);
    return null;
}

async function rememberProgress(state, thread, page, nextPostIndex, pageCount) {
    state.active = {
        threadId: String(thread.threadId),
        url: thread.url,
        title: thread.title,
        page,
        nextPostIndex,
        pageCount,
        updatedAt: new Date().toISOString()
    };
    await saveState(state);
}

async function markThreadUsed(state, thread, reason = 'completed') {
    const threadId = String(thread.threadId);
    if (!state.usedThreadIds.includes(threadId)) state.usedThreadIds.push(threadId);
    state.usedThreads.push({
        threadId,
        title: thread.title,
        url: thread.url,
        reason,
        finishedAt: new Date().toISOString()
    });
    if (state.usedThreads.length > 2000) state.usedThreads.splice(0, state.usedThreads.length - 2000);
    state.active = null;
    await saveState(state);
}

async function relayThread(session, state, thread) {
    const saved = state.active?.threadId === String(thread.threadId) ? state.active : null;
    let page = Math.max(1, Number(saved?.page) || 1);
    let nextPostIndex = Math.max(0, Number(saved?.nextPostIndex) || 0);
    let pageCount = Math.max(1, Number(saved?.pageCount) || 1);
    const postDelay = readInteger('DEBATEVOZ_POST_DELAY_MS', 8000, 1500, 120000);
    const requestDelay = readInteger('DEBATEVOZ_REQUEST_DELAY_MS', 1400, 700, 10000);

    if (session.announcedThreadId !== String(thread.threadId)) {
        await sendNotice(
            session,
            `🗣️ **VOZ · Chuyện trò linh tinh**\n**${thread.title}**\n${thread.url}\nĐang lấy đầy đủ nội dung từ trang ${page}.`
        );
        session.announcedThreadId = String(thread.threadId);
    }

    while (page <= pageCount && !session.stopRequested) {
        if (session.skipRequested) return 'skipped';
        const pageUrl = buildVozThreadPageUrl(thread.url, page);
        let html;
        try {
            html = await requestHtml(pageUrl);
        } catch (error) {
            const failure = classifyVozPageError(error, page);
            if (failure === 'end-of-thread') {
                session.currentPage = Math.max(1, page - 1);
                session.pageCount = session.currentPage;
                return 'completed';
            }
            if (failure === 'unavailable') return 'unavailable';
            throw error;
        }
        const parsed = parseVozThreadPage(html, pageUrl);
        pageCount = Math.max(pageCount, parsed.pageCount);
        thread.title = parsed.title || thread.title;
        session.currentPage = page;
        session.pageCount = pageCount;
        session.postsOnPage = parsed.posts.length;

        if (nextPostIndex > parsed.posts.length) nextPostIndex = 0;
        await rememberProgress(state, thread, page, nextPostIndex, pageCount);

        for (let index = nextPostIndex; index < parsed.posts.length; index += 1) {
            if (session.stopRequested) return 'stopped';
            if (session.skipRequested) return 'skipped';
            const post = parsed.posts[index];
            session.currentPost = index + 1;
            const replyTarget = post.replyToPostId
                ? session.sourceMessages.get(String(post.replyToPostId))
                : null;
            const sent = await sendPost(session, post, replyTarget);
            if (session.stopRequested) return 'stopped';
            if (session.skipRequested) return 'skipped';
            if (sent) {
                session.sourceMessages.set(String(post.postId), sent);
                session.sentPosts += 1;
            } else if (!session.stopRequested && !session.skipRequested) {
                session.skippedPosts += 1;
            }
            await rememberProgress(state, thread, page, index + 1, pageCount);
            if (index < parsed.posts.length - 1) await waitForSession(session, postDelay);
        }

        page += 1;
        nextPostIndex = 0;
        if (page <= pageCount) {
            await rememberProgress(state, thread, page, 0, pageCount);
            await waitForSession(session, requestDelay);
        }
    }
    return session.stopRequested ? 'stopped' : 'completed';
}

async function handleSessionError(session, error, context) {
    session.errors += 1;
    console.error(`[DEBATEVOZ] ${context}: ${error.message}`);
    if (Date.now() - session.lastErrorNoticeAt >= 10 * 60 * 1000) {
        await sendNotice(
            session,
            `⚠️ Tạm lỗi khi đọc VOZ: ${error.message}\nPhiên vẫn đang chạy và sẽ tự thử lại.`
        );
        session.lastErrorNoticeAt = Date.now();
    }
    await waitForSession(
        session,
        readInteger('DEBATEVOZ_ERROR_RETRY_MS', 60000, 5000, 30 * 60 * 1000)
    );
}

async function finishSkippedThread(session, state, thread) {
    await markThreadUsed(state, thread, 'skipped');
    session.usedCount = state.usedThreadIds.length;
    session.currentThread = null;
    session.sourceMessages.clear();
    session.announcedThreadId = null;
    session.skipRequested = false;
    await sendNotice(session, `⏭️ Đã bỏ qua và ghi nhớ bài **${thread.title}**. Đang chuyển sang bài kế tiếp.`);
}

async function runSession(session) {
    try {
        const state = await loadState();
        session.usedCount = state.usedThreadIds.length;
        while (!session.stopRequested) {
            let thread = state.active && !state.usedThreadIds.includes(String(state.active.threadId))
                ? {
                    threadId: String(state.active.threadId),
                    url: state.active.url,
                    title: state.active.title || `Bài VOZ ${state.active.threadId}`
                }
                : null;
            if (!thread) {
                try {
                    thread = await nextUnusedThread(state, session);
                } catch (error) {
                    await handleSessionError(session, error, 'Lỗi tìm bài mới');
                    continue;
                }
            }
            if (session.stopRequested) break;

            if (!thread) {
                await sendNotice(session, 'ℹ️ Chưa tìm thấy bài VOZ mới trong các trang danh mục đã quét. Sẽ kiểm tra lại sau.');
                await waitForSession(
                    session,
                    readInteger('DEBATEVOZ_EMPTY_RETRY_MS', 10 * 60 * 1000, 60000, 60 * 60 * 1000)
                );
                continue;
            }

            session.currentThread = thread;
            try {
                const result = await relayThread(session, state, thread);
                if (result === 'stopped') break;
                if (result === 'skipped' || session.skipRequested) {
                    await finishSkippedThread(session, state, thread);
                    continue;
                } else if (result === 'unavailable') {
                    await markThreadUsed(state, thread, 'not_found');
                    await sendNotice(session, `⏭️ Bài **${thread.title}** không còn tồn tại (HTTP 404), đã ghi nhớ và chuyển sang bài kế tiếp.`);
                } else {
                    await markThreadUsed(state, thread, 'completed');
                    session.completedThreads += 1;
                    await sendNotice(session, `✅ Đã lấy hết ${session.pageCount} trang của **${thread.title}**. Đang chuyển sang bài kế tiếp.`);
                    if (session.once) break;
                }
                session.usedCount = state.usedThreadIds.length;
                session.currentThread = null;
                session.sourceMessages.clear();
                session.announcedThreadId = null;
                await waitForSession(
                    session,
                    readInteger('DEBATEVOZ_THREAD_DELAY_MS', 15000, 1000, 300000)
                );
            } catch (error) {
                if (session.skipRequested) {
                    await finishSkippedThread(session, state, thread);
                } else if (!session.stopRequested) {
                    await handleSessionError(session, error, `Lỗi bài ${thread.threadId}`);
                    if (session.skipRequested) {
                        await finishSkippedThread(session, state, thread);
                    }
                }
            }
        }
    } finally {
        try {
            await sendNotice(
                session,
                `⏹️ Debate VOZ đã dừng. Đã gửi ${session.sentPosts} bài chat từ ${session.completedThreads} thread; tiến độ hiện tại đã được lưu.`
            );
        } finally {
            session.roster.close();
            releaseChannelActivity(session.channelId, MODE);
            if (activeSession === session) activeSession = null;
        }
    }
}

function statusText(session) {
    if (!session) return 'ℹ️ Debate VOZ hiện không chạy.';
    const thread = session.currentThread;
    return [
        '📊 Debate VOZ đang chạy',
        `Kênh: <#${session.channelId}>`,
        `Bài: ${thread ? thread.title : 'đang tìm bài mới'}`,
        thread ? `Trang: ${session.currentPage || 1}/${session.pageCount || '?'}` : null,
        thread ? `Tin trên trang: ${session.currentPost || 0}/${session.postsOnPage || '?'}` : null,
        `Đã gửi: ${session.sentPosts}; bỏ qua: ${session.skippedPosts}; thread hoàn tất: ${session.completedThreads}`,
        `Thread đã ghi nhớ: ${session.usedCount}; lỗi tạm thời: ${session.errors}`,
        `Danh mục: ${session.catalogRssUntil > Date.now() ? 'RSS dự phòng' : 'HTML VOZ'}`,
        `Upload media: ${session.mediaUploadsBlocked ? 'Discord đang giới hạn, dùng link dự phòng' : 'đang bật'}`
    ].filter(Boolean).join('\n');
}

export async function execute(message, args) {
    const action = String(args[0] || 'start').toLowerCase();

    if (action === 'status') return statusText(activeSession);
    if (action === 'stop' || action === 'end') {
        if (!activeSession) return 'ℹ️ Debate VOZ hiện không chạy.';
        activeSession.stopRequested = true;
        activeSession.wake?.();
        return '⏹️ Đã yêu cầu dừng Debate VOZ. Tiến độ sẽ được giữ để lần sau tiếp tục.';
    }
    if (action === 'skip' || action === 'next') {
        if (!activeSession?.currentThread) return 'ℹ️ Debate VOZ chưa có bài hiện tại để bỏ qua.';
        activeSession.skipRequested = true;
        activeSession.wake?.();
        return '⏭️ Đã yêu cầu bỏ qua bài VOZ hiện tại và chuyển sang bài kế tiếp.';
    }
    if (action === 'help') {
        return [
            ';debatevoz — chạy liên tục',
            ';debatevoz once — lấy trọn một thread rồi dừng',
            ';debatevoz status — xem tiến độ',
            ';debatevoz skip — ghi nhớ và bỏ qua thread hiện tại',
            ';debatecpt — loại tài khoản gửi lệnh khỏi phiên hiện tại',
            ';debatevoz stop — dừng và lưu điểm tiếp tục'
        ].join('\n');
    }
    if (!['start', 'once'].includes(action)) return '❌ Tham số không hợp lệ. Dùng `;debatevoz help`.';
    if (activeSession) return `❌ Debate VOZ đang chạy trong <#${activeSession.channelId}>. Dùng \`;debatevoz status\` hoặc \`;debatevoz stop\`.`;

    const channelId = String(message?.channel?.id || '');
    if (!channelId) return '❌ Không xác định được kênh hiện tại.';
    const activity = getChannelActivity(channelId);
    if (activity) return `❌ Kênh này đang chạy ${activity.mode}. Hãy dừng chế độ đó trước.`;

    const participants = await findParticipants(channelId);
    if (participants.length < 2) return '❌ Cần ít nhất 2 tài khoản có quyền xem và gửi tin trong kênh để chạy Debate VOZ.';
    if (!claimChannelActivity(channelId, MODE)) return '❌ Kênh vừa được một chế độ hội thoại khác sử dụng.';

    const session = {
        channelId,
        participants,
        once: action === 'once',
        stopRequested: false,
        skipRequested: false,
        currentThread: null,
        currentPage: 0,
        pageCount: 0,
        currentPost: 0,
        postsOnPage: 0,
        sentPosts: 0,
        skippedPosts: 0,
        completedThreads: 0,
        usedCount: 0,
        errors: 0,
        lastErrorNoticeAt: 0,
        previousSenderId: null,
        sourceMessages: new Map(),
        authorAssignments: new Map(),
        sendCounts: new Map(participants.map(item => [item.client.user.id, 0])),
        failedClientIds: new Set(),
        mediaUploadsBlocked: false,
        catalogRssUntil: 0,
        announcedThreadId: null,
        wake: null
    };
    session.roster = registerDebateRoster(
        channelId, MODE, participants.map(item => item.client.user.id),
        () => {
            session.stopRequested = true;
            session.roster.close();
            session.wake?.();
        }
    );
    activeSession = session;
    runSession(session).catch(error => {
        console.error('[DEBATEVOZ] Phiên dừng ngoài dự kiến:', error);
    });

    return `✅ Đã bật Debate VOZ với ${participants.length} tài khoản. Bot sẽ lấy tuần tự từng thread trong “Chuyện trò linh tinh”, đủ mọi trang, text, ảnh/video, reply và reaction.`;
}
