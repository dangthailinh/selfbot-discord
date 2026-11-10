import axios from 'axios';
import he from 'he';
import fs from 'fs/promises';
import path from 'path';
import { clients } from '../index.mjs';

export const name = 'debateforum';
export const description = 'Cào các thread 4chan và tạo từng bài thảo luận trong Discord Forum';
export const permission = 'everyone';

const DEFAULT_FORUM_CHANNEL_ID =
    process.env.DEBATE_FORUM_CHANNEL_ID || '1216500794367672450';
const USED_THREADS_FILE = path.join(process.cwd(), 'usedForumThreads.json');

const GENERAL_BOARDS = [
    'a', 'co', 'g', 'sci', 'v', 'vg', 'ck', 'diy', 'tv',
    'his', 'int', 'w', 'toy', 'lit', 'mu', 'fit', 'sp'
];

const DEFAULT_TOPIC_LIMIT = 5;
const MAX_TOPIC_LIMIT = 20;
const MAX_CATALOG_THREADS = 30;
const MAX_REPLIES_PER_TOPIC = 30;
const MAX_MESSAGE_LENGTH = 1900;
const MAX_FILE_SIZE = 8 * 1024 * 1024;
const REPLY_DELAY_MS = 8000;
const TOPIC_DELAY_MS = 15000;
const REQUEST_TIMEOUT_MS = 20000;

let activeSession = null;

function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function cleanText(value) {
    const decoded = he.decode(
        String(value || '')
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<\/(?:p|div)>/gi, '\n')
            .replace(/<[^>]*>/g, '')
    );

    return decoded
        .replace(/(^|\s)>>\d+/g, '$1')
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/[ \t]{2,}/g, ' ')
        .trim();
}

function truncate(value, maxLength) {
    const text = String(value || '').trim();
    if (text.length <= maxLength) return text;
    return `${text.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
}

function splitText(value, maxLength = MAX_MESSAGE_LENGTH) {
    let remaining = String(value || '').trim();
    const chunks = [];

    while (remaining.length > maxLength) {
        let splitAt = remaining.lastIndexOf('\n', maxLength);
        if (splitAt < Math.floor(maxLength / 2)) {
            splitAt = remaining.lastIndexOf(' ', maxLength);
        }
        if (splitAt < Math.floor(maxLength / 2)) splitAt = maxLength;

        chunks.push(remaining.slice(0, splitAt).trim());
        remaining = remaining.slice(splitAt).trimStart();
    }

    if (remaining) chunks.push(remaining);
    return chunks;
}

function getQuoteTarget(comment) {
    const match = he.decode(String(comment || '')).match(/>>(\d+)/);
    return match ? Number.parseInt(match[1], 10) : null;
}

function getMedia(post, board) {
    if (!post?.tim || !post?.ext) return { mediaUrl: null, mediaName: null };
    return {
        mediaUrl: `https://i.4cdn.org/${board}/${post.tim}${post.ext}`,
        mediaName: `${post.tim}${post.ext}`
    };
}

function normalizePost(post, board, threadNo) {
    const subject = cleanText(post?.sub);
    const comment = cleanText(post?.com);
    const content = subject && post?.no !== threadNo
        ? `[${subject}] ${comment}`.trim()
        : comment;
    const media = getMedia(post, board);

    return {
        postId: Number(post?.no),
        author: cleanText(post?.name) || 'Anonymous',
        subject,
        content,
        quotedPostId: getQuoteTarget(post?.com),
        ...media
    };
}

function buildForumTitle(board, thread) {
    const rawTitle =
        thread.op.subject ||
        thread.op.content.split('\n').find(Boolean) ||
        `Thread No.${thread.threadNo}`;
    return truncate(`[/${board}/] ${rawTitle}`, 100);
}

function buildRelayedContent(board, post, threadNo, isOpeningPost = false) {
    const header = `**4chan /${board}/ · ${post.author} · No.${post.postId}**`;
    const body = post.content || (post.mediaUrl ? '_Bài chỉ có media._' : '_Không có nội dung._');
    const source = isOpeningPost
        ? `\n\nNguồn: <https://boards.4chan.org/${board}/thread/${threadNo}>`
        : '';
    return `${header}\n${body}${source}`;
}

async function requestWithRetry(url, responseType = 'json', attempts = 3) {
    let lastError;

    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            return await axios.get(url, {
                responseType,
                timeout: REQUEST_TIMEOUT_MS,
                headers: { 'User-Agent': 'discord-forum-relay/1.0' }
            });
        } catch (error) {
            lastError = error;
            if (attempt < attempts) await wait(1000 * (2 ** (attempt - 1)));
        }
    }

    throw lastError;
}

async function fetchCatalog(board) {
    const response = await requestWithRetry(`https://a.4cdn.org/${board}/threads.json`);
    if (!Array.isArray(response.data)) {
        throw new Error(`Dữ liệu catalog của /${board}/ không hợp lệ.`);
    }

    const threadNumbers = [];
    const seen = new Set();
    for (const page of response.data) {
        for (const thread of page?.threads || []) {
            const threadNo = Number(thread?.no);
            if (!threadNo || seen.has(threadNo)) continue;
            seen.add(threadNo);
            threadNumbers.push(threadNo);
            if (threadNumbers.length >= MAX_CATALOG_THREADS) return threadNumbers;
        }
    }
    return threadNumbers;
}

async function fetchThread(board, threadNo) {
    const response = await requestWithRetry(
        `https://a.4cdn.org/${board}/thread/${threadNo}.json`
    );
    const rawPosts = response.data?.posts;
    if (!Array.isArray(rawPosts) || rawPosts.length === 0) {
        throw new Error(`Thread /${board}/${threadNo} không có bài hợp lệ.`);
    }

    const posts = rawPosts
        .map(post => normalizePost(post, board, threadNo))
        .filter(post => post.postId && (post.content || post.mediaUrl));

    if (posts.length === 0) {
        throw new Error(`Thread /${board}/${threadNo} không có text hoặc media.`);
    }

    return {
        board,
        threadNo,
        op: posts[0],
        replies: posts.slice(1, MAX_REPLIES_PER_TOPIC + 1)
    };
}

async function downloadMedia(mediaUrl, mediaName) {
    if (!mediaUrl) return null;

    try {
        const response = await requestWithRetry(mediaUrl, 'arraybuffer', 2);
        const size = Number(response.headers?.['content-length']) || response.data?.byteLength || 0;
        if (size > MAX_FILE_SIZE) {
            console.warn(`[DEBATEFORUM] Bỏ media quá 8 MB: ${mediaUrl}`);
            return null;
        }
        return {
            attachment: Buffer.from(response.data),
            name: mediaName || '4chan-media'
        };
    } catch (error) {
        console.warn(`[DEBATEFORUM] Không tải được media ${mediaUrl}: ${error.message}`);
        return null;
    }
}

async function loadUsedThreads() {
    try {
        const parsed = JSON.parse(await fs.readFile(USED_THREADS_FILE, 'utf8'));
        const entries = Array.isArray(parsed?.threads) ? parsed.threads : [];
        return {
            entries,
            keys: new Set(entries.map(entry => entry?.key).filter(Boolean))
        };
    } catch (error) {
        if (error.code !== 'ENOENT') {
            console.warn(`[DEBATEFORUM] Không đọc được lịch sử: ${error.message}`);
        }
        return { entries: [], keys: new Set() };
    }
}

async function saveUsedThread(store, entry) {
    store.keys.add(entry.key);
    store.entries.push(entry);
    if (store.entries.length > 1000) {
        store.entries.splice(0, store.entries.length - 1000);
    }
    await fs.writeFile(
        USED_THREADS_FILE,
        JSON.stringify({ version: 1, threads: store.entries }, null, 2),
        'utf8'
    );
}

async function fetchChannel(client, channelId) {
    if (!client?.user) return null;
    return client.channels.cache.get(channelId) ||
        await client.channels.fetch(channelId).catch(() => null);
}

function rotateClients(items, offset) {
    if (items.length === 0) return [];
    const start = Math.abs(offset) % items.length;
    return [...items.slice(start), ...items.slice(0, start)];
}

async function createForumTopic(thread, session, mediaFile) {
    const orderedClients = rotateClients(session.availableClients, session.topicsCreated);
    let lastError = null;

    for (const candidate of orderedClients) {
        if (session.stopRequested) return null;

        const forum = await fetchChannel(candidate, session.forumChannelId);
        if (!forum?.threads || typeof forum.threads.create !== 'function') continue;

        const content = truncate(
            buildRelayedContent(thread.board, thread.op, thread.threadNo, true),
            MAX_MESSAGE_LENGTH
        );
        const messagePayload = { content };
        if (mediaFile) messagePayload.files = [mediaFile];

        const createOptions = {
            name: buildForumTitle(thread.board, thread),
            autoArchiveDuration: 1440,
            rateLimitPerUser: 5,
            message: messagePayload,
            reason: `Relay 4chan /${thread.board}/ thread ${thread.threadNo}`
        };

        if (forum.flags?.has?.('REQUIRE_TAG')) {
            if (!Array.isArray(forum.availableTags) || forum.availableTags.length === 0) {
                lastError = new Error('Forum bắt buộc tag nhưng chưa có tag khả dụng.');
                continue;
            }
            createOptions.appliedTags = [forum.availableTags[0].id];
        }

        try {
            const discordThread = await forum.threads.create(createOptions);
            return { discordThread, creator: candidate };
        } catch (error) {
            lastError = error;
            console.warn(
                `[DEBATEFORUM] ${candidate.user.username} không tạo được forum post: ${error.message}`
            );
        }
    }

    throw lastError || new Error(
        `Không tài khoản nào truy cập hoặc tạo bài được trong forum ${session.forumChannelId}.`
    );
}

function getReplyCandidates(session, previousSenderId) {
    const ordered = rotateClients(session.availableClients, session.repliesSent);
    return [
        ...ordered.filter(candidate => candidate.user.id !== previousSenderId),
        ...ordered.filter(candidate => candidate.user.id === previousSenderId)
    ];
}

async function sendReplyPost(session, discordThreadId, post, replyTarget, mediaFile) {
    let lastError = null;

    for (const candidate of getReplyCandidates(session, replyTarget?.senderId)) {
        if (session.stopRequested) return null;

        const channel = await fetchChannel(candidate, discordThreadId);
        if (!channel?.messages || typeof channel.send !== 'function') continue;

        const content = buildRelayedContent(session.currentBoard, post, session.currentThreadNo);
        const chunks = splitText(content);
        if (chunks.length === 0 && !mediaFile) return null;

        try {
            let firstMessage = null;
            let targetMessage = null;
            if (replyTarget?.messageId) {
                targetMessage = await channel.messages.fetch(replyTarget.messageId).catch(() => null);
            }

            for (let index = 0; index < Math.max(1, chunks.length); index++) {
                const payload = {};
                if (chunks[index]) payload.content = chunks[index];
                if (index === 0 && mediaFile) payload.files = [mediaFile];

                const sent = index === 0 && targetMessage
                    ? await targetMessage.reply(payload)
                    : await channel.send(payload);
                if (!firstMessage) firstMessage = sent;
            }

            return {
                messageId: firstMessage?.id || null,
                senderId: candidate.user.id
            };
        } catch (error) {
            lastError = error;
            console.warn(
                `[DEBATEFORUM] ${candidate.user.username} không gửi được reply No.${post.postId}: ${error.message}`
            );
        }
    }

    console.warn(
        `[DEBATEFORUM] Bỏ reply No.${post.postId}: ${lastError?.message || 'không có client phù hợp'}`
    );
    return null;
}

async function relayThread(thread, session, onTopicCreated) {
    const openingMedia = await downloadMedia(thread.op.mediaUrl, thread.op.mediaName);
    const created = await createForumTopic(thread, session, openingMedia);
    if (!created) return null;

    const discordThreadId = created.discordThread.id;
    await onTopicCreated(discordThreadId);

    const messageMap = new Map([
        [thread.op.postId, {
            messageId: discordThreadId,
            senderId: created.creator.user.id
        }]
    ]);
    let previousMessage = messageMap.get(thread.op.postId);

    session.currentDiscordThreadId = discordThreadId;
    session.repliesInCurrentTopic = 0;

    for (const post of thread.replies) {
        if (session.stopRequested) break;

        const mediaFile = await downloadMedia(post.mediaUrl, post.mediaName);
        const quoteTarget = post.quotedPostId
            ? messageMap.get(post.quotedPostId)
            : null;
        const sent = await sendReplyPost(
            session,
            discordThreadId,
            post,
            quoteTarget || previousMessage,
            mediaFile
        );

        if (sent?.messageId) {
            messageMap.set(post.postId, sent);
            previousMessage = sent;
            session.repliesSent++;
            session.repliesInCurrentTopic++;
        }

        if (!session.stopRequested) await wait(REPLY_DELAY_MS);
    }

    return discordThreadId;
}

async function sendSessionNotice(session, content) {
    const client =
        session.availableClients.find(item => item.user.id === session.startedByClientId) ||
        session.availableClients[0];
    const channel = await fetchChannel(client, session.commandChannelId);
    if (!channel?.send) return;

    const notice = await channel.send(content).catch(() => null);
    if (notice) setTimeout(() => notice.delete().catch(() => {}), 60000);
}

function chooseBoard(input) {
    const normalized = String(input || 'general').toLowerCase();
    if (normalized === 'general' || normalized === 'random') {
        return GENERAL_BOARDS[Math.floor(Math.random() * GENERAL_BOARDS.length)];
    }
    if (!/^[a-z0-9]+$/i.test(normalized)) {
        throw new Error('Tên board chỉ được chứa chữ và số.');
    }
    return normalized;
}

async function runSession(session) {
    const usedStore = await loadUsedThreads();
    let completionNoticeNeeded = true;

    try {
        session.currentBoard = chooseBoard(session.boardInput);
        const catalog = await fetchCatalog(session.currentBoard);
        const freshThreadNumbers = catalog
            .filter(threadNo => !usedStore.keys.has(`${session.currentBoard}:${threadNo}`))
            .slice(0, session.topicLimit);

        if (freshThreadNumbers.length === 0) {
            await sendSessionNotice(
                session,
                `ℹ️ Không tìm thấy thread mới trong 4chan /${session.currentBoard}/.`
            );
            completionNoticeNeeded = false;
            return;
        }

        for (let threadIndex = 0; threadIndex < freshThreadNumbers.length; threadIndex++) {
            const threadNo = freshThreadNumbers[threadIndex];
            if (session.stopRequested) break;

            session.currentThreadNo = threadNo;
            session.currentDiscordThreadId = null;
            session.phase = 'fetching_thread';

            let thread;
            try {
                thread = await fetchThread(session.currentBoard, threadNo);
            } catch (error) {
                session.skipped++;
                session.lastError = error.message;
                console.warn(`[DEBATEFORUM] Bỏ thread ${threadNo}: ${error.message}`);
                continue;
            }

            try {
                session.phase = 'creating_topic';
                const discordThreadId = await relayThread(
                    thread,
                    session,
                    async createdThreadId => {
                        session.topicsCreated++;
                        await saveUsedThread(usedStore, {
                            key: `${session.currentBoard}:${threadNo}`,
                            board: session.currentBoard,
                            threadNo,
                            discordThreadId: createdThreadId,
                            createdAt: new Date().toISOString()
                        });
                    }
                );
                if (!discordThreadId) break;
            } catch (error) {
                session.skipped++;
                session.lastError = error.message;
                console.error(`[DEBATEFORUM] Lỗi xử lý thread ${threadNo}:`, error.message);
            }

            if (!session.stopRequested && threadIndex < freshThreadNumbers.length - 1) {
                session.phase = 'waiting_next_topic';
                await wait(TOPIC_DELAY_MS);
            }
        }
    } catch (error) {
        session.phase = 'failed';
        session.lastError = error.message;
        throw error;
    } finally {
        if (session.phase !== 'failed') {
            session.phase = session.stopRequested ? 'stopped' : 'completed';
            if (completionNoticeNeeded) {
                const result = session.stopRequested ? 'đã dừng' : 'đã hoàn tất';
                await sendSessionNotice(
                    session,
                    `✅ Debate Forum ${result}: ${session.topicsCreated} topic, ` +
                    `${session.repliesSent} reply, bỏ qua ${session.skipped}.`
                );
            }
        }
        if (activeSession === session) activeSession = null;
    }
}

function getStatusText(session) {
    if (!session) return 'ℹ️ Debate Forum hiện không chạy.';
    const elapsedSeconds = Math.floor((Date.now() - session.startedAt) / 1000);
    return [
        '📊 **Debate Forum đang chạy**',
        `• Forum: <#${session.forumChannelId}>`,
        `• Board: /${session.currentBoard || session.boardInput}/`,
        `• Giai đoạn: ${session.phase}`,
        `• Topic: ${session.topicsCreated}/${session.topicLimit}`,
        `• Reply đã gửi: ${session.repliesSent}`,
        `• Thread hiện tại: ${session.currentThreadNo || '-'}`,
        `• Thời gian: ${elapsedSeconds}s`
    ].join('\n');
}

export async function execute(message, args, client) {
    const action = String(args[0] || '').toLowerCase();

    if (action === 'stop') {
        if (!activeSession) return 'ℹ️ Debate Forum hiện không chạy.';
        activeSession.stopRequested = true;
        activeSession.phase = 'stopping';
        return '⏹️ Đã yêu cầu dừng Debate Forum sau thao tác hiện tại.';
    }

    if (action === 'status') {
        return getStatusText(activeSession);
    }

    if (action === 'help') {
        return [
            'Cách dùng:',
            '`;debateforum [board|general|random] [số topic]`',
            '`;debateforum status`',
            '`;debateforum stop`',
            `Mặc định ${DEFAULT_TOPIC_LIMIT} topic, tối đa ${MAX_TOPIC_LIMIT}.`
        ].join('\n');
    }

    if (activeSession) {
        return '❌ Debate Forum đang chạy. Dùng `;debateforum status` hoặc `;debateforum stop`.';
    }

    let boardInput;
    try {
        boardInput = action || 'general';
        chooseBoard(boardInput);
    } catch (error) {
        return `❌ ${error.message}`;
    }

    const rawLimit = args[1];
    const requestedLimit = rawLimit === undefined
        ? DEFAULT_TOPIC_LIMIT
        : Number.parseInt(rawLimit, 10);
    if (
        (rawLimit !== undefined && !/^\d+$/.test(rawLimit)) ||
        !Number.isInteger(requestedLimit) ||
        requestedLimit < 1 ||
        requestedLimit > MAX_TOPIC_LIMIT
    ) {
        return `❌ Số topic phải từ 1 đến ${MAX_TOPIC_LIMIT}.`;
    }

    const availableClients = clients.filter(candidate => candidate?.user?.id);
    if (availableClients.length < 2) {
        return '❌ Cần ít nhất 2 tài khoản đang kết nối để thảo luận.';
    }

    let forumAccessClient = null;
    for (const candidate of availableClients) {
        const forumProbe = await fetchChannel(candidate, DEFAULT_FORUM_CHANNEL_ID);
        if (forumProbe?.threads && typeof forumProbe.threads.create === 'function') {
            forumAccessClient = candidate;
            break;
        }
    }
    if (!forumAccessClient) {
        return `❌ Không tài khoản nào truy cập được forum <#${DEFAULT_FORUM_CHANNEL_ID}>.`;
    }

    const session = {
        forumChannelId: DEFAULT_FORUM_CHANNEL_ID,
        boardInput,
        currentBoard: null,
        topicLimit: requestedLimit,
        topicsCreated: 0,
        repliesSent: 0,
        repliesInCurrentTopic: 0,
        skipped: 0,
        stopRequested: false,
        phase: 'starting',
        currentThreadNo: null,
        currentDiscordThreadId: null,
        lastError: null,
        startedAt: Date.now(),
        startedByClientId: client.user.id,
        commandChannelId: message.channel.id,
        availableClients
    };

    activeSession = session;
    void runSession(session).catch(async error => {
        session.lastError = error.message;
        console.error('[DEBATEFORUM] Phiên chạy thất bại:', error);
        await sendSessionNotice(session, `❌ Debate Forum gặp lỗi: ${error.message}`);
        if (activeSession === session) activeSession = null;
    });

    return (
        `✅ Đã bắt đầu Debate Forum trong <#${DEFAULT_FORUM_CHANNEL_ID}>: ` +
        `/${boardInput}/, tối đa ${requestedLimit} topic.`
    );
}
