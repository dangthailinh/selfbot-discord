        import { clients } from '../index.mjs'; // Import để truy cập nhiều clients
        import axios from 'axios'; // Để fetch từ 4chan API và download media
        import he from 'he'; // Để decode HTML entities (npm install he)
        import fs from 'fs/promises'; // Để lưu file JSON async (Node.js built-in, dùng promises)
        import path from 'path';
        import crypto from 'node:crypto';
        import {
            claimChannelActivity,
            getChannelActivity,
            releaseChannelActivity
        } from '../handlers/channelActivityStore.mjs';
        import { sendWithUploadFallback } from '../handlers/debateSendPolicy.mjs';
        import { findRoleplayParticipants } from '../handlers/roleplayParticipants.mjs';
        import { registerDebateRoster, guardDebateChannel } from '../handlers/debateRoster.mjs';

        export const name = 'debate';
        export const permission = 'everyone';

        const adultBoards = [
            'd',    // Hentai/Alternative
            'e',    // Ecchi
            'f',    // Flash
            'gif',  // Adult GIF
            'h',    // Hentai
            'hc',   // Hardcore
            'r9k',  // Robot 9000
            'hr',   // High Resolution Hentai
            's',    // Sexy Beautiful Women
            't',
            'p',
            'trash',
                's4s',
                'wsg',
                "pol",


            'xs',   // X-rated Screenshots
            'aco',  // Adult Cartoons
            'lgbt', // Lesbian, Gay, Bisexual, Transgender
            'r',    // Adult Requests
            'b',    // Random (Ngẫu nhiên - Bảng chính)
            'his',
            'u',
            'bant',
            'a',
            'c',
            'sci',
            'x',
            'v',
            'vg',

        ];

        const generalBoards = [
            'a',    // Anime & Manga
            'c',    // Adult Cartoons
            'v',    // Video Games
            'vg',   // Video Game Generals
            'g',    // Technology
            'sci',  // Science & Math
            'trash',// Off-Topic
            'x',    // Paranormal
            'an',
            'gd',
            'co',   // Artis
            'adv',
                'm',
                'toy',
                'ck',
                'diy',
                'tv',
                'his',
                'diy',
                'int',
                'w'
        ];

        const allBoards = [...adultBoards, ...generalBoards];

        let rolePlayInterval = null;
        let rolePlayChannelId = null;
        let rolePlayStarterClient = null;
        let rolePlayParticipants = [];
        let postHistory = [];
        let currentPostIndex = 0;
        let currentBoard = null;
        let scrapedLogFile = path.join(process.cwd(), 'scraped_posts.json'); // File JSON để lưu log các cycle
        let postToDiscordMessage = new Map();
        let cycleCount = 0;
        let sendCounts = new Map();
        let failedClientIds = new Set();
        let rolePlayStarting = false;
        let rolePlayTurnRunning = false;
        let rolePlayStopRequested = false;
        let rolePlayRunId = 0;
        let rolePlayRoster = null;
        const mediaUploadBlockedUntil = new Map();

        function mediaUploadsAllowed(channelId) {
            const blockedUntil = mediaUploadBlockedUntil.get(String(channelId)) || 0;
            if (blockedUntil <= Date.now()) {
                mediaUploadBlockedUntil.delete(String(channelId));
                return true;
            }
            return false;
        }

        function blockMediaUploads(channelId) {
            const cooldownMs = Math.max(
                60000,
                Number.parseInt(process.env.DEBATE_MEDIA_UPLOAD_COOLDOWN_MS || '', 10)
                    || 6 * 60 * 60 * 1000
            );
            mediaUploadBlockedUntil.set(String(channelId), Date.now() + cooldownMs);
        }

        function debateDebug(message) {
            if (['1', 'true', 'yes', 'on'].includes(
                String(process.env.DEBATE_DEBUG_LOGS || '').trim().toLowerCase()
            )) {
                console.log(message);
            }
        }

        function finishDebate() {
            rolePlayRoster?.close();
            rolePlayRoster = null;
            if (rolePlayInterval) clearInterval(rolePlayInterval);
            rolePlayInterval = null;
            rolePlayTurnRunning = false;
            rolePlayStarting = false;
            if (rolePlayChannelId) releaseChannelActivity(rolePlayChannelId, 'debate');
            rolePlayChannelId = null;
        }

        export function getDebateStatus() {
            return {
                active: Boolean(rolePlayInterval || rolePlayStarting),
                channelId: rolePlayChannelId,
                board: currentBoard,
                postIndex: currentPostIndex,
                totalPosts: postHistory.length,
                mediaUploadsAllowed: rolePlayChannelId
                    ? mediaUploadsAllowed(rolePlayChannelId)
                    : true
            };
        }

        // Random emojis cho react, nhưng sẽ chọn theo ngữ cảnh
        const contextEmojis = {
            positive: ['👍', '😂', '🔥', '💯', '🤝'], // Vui vẻ, đồng ý
            negative: ['👎', '😡', '❓'], // Phản đối, giận dữ
            neutral: ['🤔', '😲'] // Suy nghĩ, bất ngờ
        };


        const allRandomEmojis = [
            ...contextEmojis.positive, ...contextEmojis.negative, ...contextEmojis.neutral,
            '❤️', '😍', '🥰', '😘', '🤗', '🤩', '😎', '🥳', '😭', '😢', '😠', '😤', '🤬',
            '😏', '🙄', '😬', '🤐', '😶', '😐', '😑', '😳', '🥺', '😩', '🤯', '😱', '😵',
            '🤠', '🤡', '🥸', '🤓', '🧐', '🤥', '🤫', '🤭', '🫢', '🫣', '🫡', '🫠', '🥰'
        ];

        // Keywords để phân loại ngữ cảnh (simple keyword matching)
        const positiveKeywords = ['good', 'great', 'love', 'yes', 'agree', 'hot', 'sexy', 'awesome', 'best'];
        const negativeKeywords = ['bad', 'hate', 'no', 'suck', 'worst', 'fail', 'stupid'];

        // Max file size (Discord free tier: 8MB)
        const MAX_FILE_SIZE = 8 * 1024 * 1024; // 8MB

        // Hàm chọn emoji theo ngữ cảnh: Ưu tiên emoji tùy chỉnh từ server, fallback sang Unicode
        // THÊM: Tự động sử dụng emoji sẵn có của server (guild)
        function getContextEmoji(content, guild = null) {
            const lowerContent = content.toLowerCase();
            let score = 0;
            for (const kw of positiveKeywords) {
                if (lowerContent.includes(kw)) score += 1;
            }
            for (const kw of negativeKeywords) {
                if (lowerContent.includes(kw)) score -= 1;
            }
            let emojiSet;
            if (score > 0) {
                emojiSet = contextEmojis.positive;
            } else if (score < 0) {
                emojiSet = contextEmojis.negative;
            } else {
                emojiSet = contextEmojis.neutral;
            }

            // THÊM: Nếu có guild, thử lấy random emoji tùy chỉnh từ guild (lọc theo tên nếu có thể, nhưng đơn giản random)
            if (guild && guild.emojis.cache.size > 0) {
                const customEmojis = guild.emojis.cache.random(); // Chọn random một emoji từ guild
                if (customEmojis) {
                    // Sử dụng format cho custom emoji: <a:name:id> nếu animated, hoặc <name:id>
                    return customEmojis.animated ? `<a:${customEmojis.name}:${customEmojis.id}>` : `<:${customEmojis.name}:${customEmojis.id}>`;
                }
            }

            // Fallback sang Unicode
            return emojiSet[Math.floor(Math.random() * emojiSet.length)];
        }

        // THÊM: Hàm chọn emoji ngẫu nhiên từ pool lớn (cho multiple reacts)
        function getRandomEmoji(guild = null) {
            // THÊM: Nếu có guild, thử lấy random emoji tùy chỉnh từ guild
            if (guild && guild.emojis.cache.size > 0) {
                const customEmojis = guild.emojis.cache.random(); // Chọn random một emoji từ guild
                if (customEmojis) {
                    // Sử dụng format cho custom emoji: <a:name:id> nếu animated, hoặc <name:id>
                    return customEmojis.animated ? `<a:${customEmojis.name}:${customEmojis.id}>` : `<:${customEmojis.name}:${customEmojis.id}>`;
                }
            }

            // Fallback sang Unicode pool lớn
            return allRandomEmojis[Math.floor(Math.random() * allRandomEmojis.length)];
        }

        // Hàm download media buffer từ 4chan URL (tăng timeout cho video, handle webm tốt hơn)
        async function downloadMedia(url) {
            try {
                const response = await axios.get(url, {
                    responseType: 'arraybuffer',
                    timeout: 30000, // Tăng timeout lên 30s cho video lớn
                    headers: { 'User-Agent': '4chan-scraper/1.0' } // Thêm UA để tránh block
                });
                if (response.data.length > MAX_FILE_SIZE) {
                    console.log(`Media too large (${response.data.length} bytes), skipping.`);
                    return null;
                }
                return Buffer.from(response.data);
            } catch (err) {
                console.error(`Failed to download media ${url}:`, err.message);
                return null;
            }
        }

        function cleanContentAdvanced(content) {
            let cleaned = String(content ?? '')
                .replace(/<br\s*\/?>/gi, '\n')
                .replace(/<\/(?:p|div)>/gi, '\n')
                .replace(/<[^>]*>/g, '');

            cleaned = he.decode(cleaned);
            cleaned = cleaned.replace(/>>\d+/g, ''); // Link reply sẽ được chuyển thành Discord reply thật
            cleaned = cleaned.replace(/(^|\n)\s*>\s?/g, '$1'); // Bỏ dấu greentext ">" ở đầu dòng
            cleaned = cleaned.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
            return cleaned.replace(/\s+/g, ' ').trim();
        }

        function shuffleArray(items) {
            const shuffled = [...items];
            for (let i = shuffled.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
            }
            return shuffled;
        }

        // Vẫn xáo trộn nội dung, nhưng bảo đảm post gốc được gửi trước post reply nếu cả hai cùng tồn tại.
        function orderPostsForDebate(posts) {
            const pending = shuffleArray(posts);
            const knownPostIds = new Set(pending.map(post => post.postId));
            const emittedPostIds = new Set();
            const ordered = [];

            while (pending.length > 0) {
                const readyIndex = pending.findIndex(post =>
                    !post.quotedPostId ||
                    !knownPostIds.has(post.quotedPostId) ||
                    emittedPostIds.has(post.quotedPostId)
                );
                const index = readyIndex === -1 ? 0 : readyIndex;
                const [post] = pending.splice(index, 1);
                ordered.push(post);
                emittedPostIds.add(post.postId);
            }

            return ordered;
        }

        function getBalancedClientCandidates(allActiveClients, avoidClientIds = new Set()) {
            return allActiveClients
                .filter(client => client?.user?.id)
                .filter(client => rolePlayRoster?.has(client.user.id))
                .filter(client => !failedClientIds.has(client.user.id))
                .map(client => ({ client, randomOrder: Math.random() }))
                .sort((a, b) => {
                    const aShouldAvoid = avoidClientIds.has(a.client.user.id) ? 1 : 0;
                    const bShouldAvoid = avoidClientIds.has(b.client.user.id) ? 1 : 0;
                    if (aShouldAvoid !== bShouldAvoid) return aShouldAvoid - bShouldAvoid;

                    const countDifference =
                        (sendCounts.get(a.client.user.id) || 0) -
                        (sendCounts.get(b.client.user.id) || 0);
                    if (countDifference !== 0) return countDifference;
                    return a.randomOrder - b.randomOrder;
                })
                .map(({ client }) => client);
        }

        function isFatalClientSendError(error) {
            const code = Number(error?.code);
            // Đây là lỗi của riêng tài khoản/quyền truy cập; lỗi payload/media không được loại tài khoản.
            return code === 40001 || code === 50001 || code === 50013;
        }

        async function sendSplitMessage(client, channelId, text, files = [], replyTarget = null, roster = rolePlayRoster) {
            const maxLength = 1900; // An toàn dưới 2000
            const messages = [];
            let firstMsgId = null;
            let lastMsgId = null;
            const rawText = typeof text === 'string' ? text : '';
            const mediaSuppressed = files.length > 0 && !mediaUploadsAllowed(channelId);
            if (mediaSuppressed) files = [];

            // Nếu text rỗng và không có files, skip toàn bộ
            if (rawText.trim() === '' && (!files || files.length === 0)) {
                console.log(`Skipping empty message for client ${client.user.username}`);
                return {
                    success: true,
                    complete: true,
                    mediaSkipped: mediaSuppressed,
                    firstMsgId: null,
                    lastMsgId: null
                };
            }

            const cleanText = cleanContentAdvanced(rawText);

            if (cleanText.length <= maxLength) {
                if (cleanText.trim()) { // Chỉ push nếu non-empty
                    messages.push({ content: cleanText.trim(), files: files.slice() }); // Copy files để tránh mutate
                } else if (files.length > 0) {
                    // Media-only: không tạo field content vì thư viện từ chối content: ''.
                    messages.push({ files: files.slice() });
                }
            } else {
                // cleanContentAdvanced đã gộp whitespace, nên tách theo từ để mọi chunk luôn <= 1900 ký tự.
                let remainingText = cleanText;
                while (remainingText.length > maxLength) {
                    let splitAt = remainingText.lastIndexOf(' ', maxLength);
                    if (splitAt < Math.floor(maxLength / 2)) splitAt = maxLength;
                    messages.push({
                        content: remainingText.slice(0, splitAt).trim(),
                        files: messages.length === 0 ? files.slice() : []
                    });
                    remainingText = remainingText.slice(splitAt).trimStart();
                }
                if (remainingText.trim()) {
                    messages.push({
                        content: remainingText.trim(),
                        files: messages.length === 0 ? files.slice() : []
                    });
                }
            }

            // Nếu không có messages hợp lệ, skip
            if (messages.length === 0) {
                console.log(`No valid messages to send for client ${client.user.username} (all chunks empty)`);
                return { success: true, complete: true, firstMsgId: null, lastMsgId: null };
            }

            const channel = client.channels.cache.get(channelId);
            if (!channel) {
                console.error(`Channel ${channelId} not found in cache for client ${client.user.username}`);
                return {
                    success: false,
                    complete: false,
                    clientFatal: true,
                    firstMsgId: null,
                    lastMsgId: null
                };
            }

            for (let i = 0; i < messages.length; i++) {
                const { content, files: msgFiles } = messages[i];
                try {
                    // Delay ngẫu nhiên để simulate tự nhiên, nhưng ngắn hơn để tránh lag
                    await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000)); // Random delay 1-3s

                    const sendOptions = {
                        files: msgFiles,
                        // Không cho nội dung 4chan kích hoạt @everyone/@role ngoài ý muốn.
                        allowedMentions: { parse: [], repliedUser: false }
                    };
                    if (typeof content === 'string' && content.trim()) {
                        sendOptions.content = content;
                    }
                    let replyTargetId = null;
                    if (i === 0) {
                        replyTargetId = replyTarget?.messageId ?? null;
                    } else {
                        replyTargetId = lastMsgId;
                    }
                    if (replyTargetId) {
                        // discord.js-selfbot-v13 yêu cầu key messageReference, không phải messageId.
                        sendOptions.reply = { messageReference: replyTargetId, failIfNotExists: false };
                        sendOptions.allowedMentions.repliedUser =
                            i === 0 &&
                            Boolean(replyTarget?.senderId) &&
                            replyTarget.senderId !== client.user.id;
                    }

                    const sendResult = await sendWithUploadFallback(
                        guardDebateChannel(channel, roster, client.user.id), sendOptions
                    );
                    if (sendResult.uploadLimited) {
                        blockMediaUploads(channelId);
                        console.warn(
                            `[DEBATE] Discord đã giới hạn upload trong guild; kênh ${channelId} tạm chuyển sang chỉ gửi văn bản.`
                        );
                    }
                    if (sendResult.mediaSkipped) {
                        return {
                            success: true,
                            complete: true,
                            mediaSkipped: true,
                            firstMsgId,
                            lastMsgId
                        };
                    }
                    const sentMsg = sendResult.message;

                    if (!firstMsgId) {
                        firstMsgId = sentMsg.id;
                    }
                    lastMsgId = sentMsg.id;

                    // Delay giữa messages nếu dài, nhưng ngắn hơn
                    const extraDelay = messages.length > 1 ? 3000 : 1000;
                    await new Promise(resolve => setTimeout(resolve, extraDelay));
                } catch (sendErr) {
                    console.error(`Send error in channel ${channelId} for client ${client.user.username}:`, sendErr.message);
                    // Nếu đã gửi được một phần, giữ chain tại tin cuối cùng để không gửi trùng toàn bộ nội dung.
                    return {
                        success: Boolean(firstMsgId),
                        complete: false,
                        clientFatal: isFatalClientSendError(sendErr),
                        firstMsgId,
                        lastMsgId,
                        error: sendErr
                    };
                }
            }

            return { success: true, complete: true, firstMsgId, lastMsgId };
        }

        // Hàm lưu log cycle vào JSON (SỬA: Chỉ lưu hashes thay vì full posts để tiết kiệm không gian và tránh duplicate tốt hơn; giữ max 50 entries)
        async function saveScrapedLog(board, newTextHashes, newMediaUrls) {
            try {
                const logEntry = {
                    board: board,
                    timestamp: new Date().toISOString(),
                    textHashes: newTextHashes || [],
                    mediaUrls: newMediaUrls || []
                };
                let existingData = [];
                try {
                    const fileContent = await fs.readFile(scrapedLogFile, 'utf8');
                    existingData = JSON.parse(fileContent);
                    if (!Array.isArray(existingData)) {
                        existingData = [];
                    }
                } catch (readErr) {
                    if (readErr.code !== 'ENOENT') {
                        console.error('Error reading scraped log:', readErr.message);
                    }
                    // File không tồn tại: bắt đầu mới
                }
                existingData.push(logEntry);
                // THÊM: Giới hạn chỉ giữ 50 entries gần nhất để tránh file quá lớn
                if (existingData.length > 50) {
                    existingData = existingData.slice(-50);
                }
                await fs.writeFile(scrapedLogFile, JSON.stringify(existingData, null, 2));
                console.log(`Saved scraped log to ${scrapedLogFile} (total entries: ${existingData.length}, new texts: ${newTextHashes?.length || 0}, medias: ${newMediaUrls?.length || 0})`);
            } catch (saveErr) {
                console.error('Failed to save scraped log:', saveErr.message);
            }
        }

        // Hàm load historical hashes từ log để dedup toàn cục (SỬA: Load từ hashes thay vì full posts)
        async function loadHistoricalHashes() {
            const seenPosts = new Set(); // Cho text-only hoặc text trong posts có media
            const seenMedia = new Set(); // Cho media URLs
            try {
                const fileContent = await fs.readFile(scrapedLogFile, 'utf8');
                const logs = JSON.parse(fileContent);
                if (Array.isArray(logs)) {
                    for (const log of logs) {
                        if (log.textHashes && Array.isArray(log.textHashes)) {
                            for (const hash of log.textHashes) {
                                seenPosts.add(hash);
                            }
                        }
                        if (log.mediaUrls && Array.isArray(log.mediaUrls)) {
                            for (const url of log.mediaUrls) {
                                seenMedia.add(url);
                            }
                        }
                    }
                }
                console.log(`Loaded ${seenPosts.size} text hashes and ${seenMedia.size} media URLs for deduplication`);
            } catch (err) {
                if (err.code !== 'ENOENT') {
                    console.error('Error loading historical hashes:', err.message);
                }
                // File không tồn tại: seen rỗng
            }
            return { seenPosts, seenMedia };
        }

        // THÊM: Hàm retry fetch với exponential backoff (để handle 4chan instability post-2025 hack)
        async function fetchWithRetry(url, options, maxRetries = 3) {
            for (let attempt = 1; attempt <= maxRetries; attempt++) {
                try {
                    return await axios.get(url, options);
                } catch (err) {
                    if (attempt === maxRetries) throw err;
                    const delay = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s
                    console.log(`Fetch retry ${attempt}/${maxRetries} for ${url} after ${delay}ms delay`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }

        // Hàm random board khác với currentBoard (THÊM: Để tránh duplicate khi cycle)
        function getRandomBoard(boards, currentBoard, maxAttempts = 10) {
            let newBoard;
            let attempts = 0;
            do {
                newBoard = boards[Math.floor(Math.random() * boards.length)];
                attempts++;
            } while (newBoard === currentBoard && attempts < maxAttempts);
            // Fallback nếu không tìm được khác (hiếm)
            return newBoard;
        }

        async function fetch4chanPosts(board) {
            let allPosts = [];
            let newTextHashes = [];
            let newMediaUrls = [];
            let { seenPosts, seenMedia } = { seenPosts: new Set(), seenMedia: new Set() }; // Defaults nếu load fail
            try {
                // FIX: Load historical hashes trước khi fetch mới
                ({ seenPosts, seenMedia } = await loadHistoricalHashes());
                console.log(`Fetching threads from /${board}/... (with ${seenPosts.size} text & ${seenMedia.size} media dedups)`);
                // SỬA: Chỉ fetch page 0 (current threads) để tránh archives cũ gây duplicate
                const threadsUrl = `https://a.4cdn.org/${board}/threads.json`; // Không ?N, chỉ current page
                const threadsRes = await fetchWithRetry(threadsUrl, {
                    headers: { 'User-Agent': '4chan-scraper/1.0' }
                });
                const threadsData = threadsRes.data;

                if (!Array.isArray(threadsData) || threadsData.length === 0) {
                    throw new Error('Invalid API response: threads.json is not an array.');
                }

                // Collect threadNos từ current page (SỬA: Tăng maxThreadsPerPage=20; dùng Set unique dù hiếm overlap)
                let threadNosSet = new Set();
                const maxThreadsPerPage = 20; // Tăng để lấy nhiều threads fresh hơn
                const maxPages = 1; // Chỉ current page để tránh old posts
                let pageCount = 0;

                for (const page of threadsData) {
                    if (pageCount >= maxPages || threadNosSet.size >= 100) break; // Limit total threads
                    if (page && page.threads && Array.isArray(page.threads)) {
                        const pageThreads = page.threads
                            .slice(0, maxThreadsPerPage)
                            .map(t => t.no)
                            .filter(no => no);
                        pageThreads.forEach(no => threadNosSet.add(no));
                        console.log(`Page ${pageCount + 1}: Added ${pageThreads.length} threads (total unique: ${threadNosSet.size})`);
                    }
                    pageCount++;
                    await new Promise(resolve => setTimeout(resolve, 500));
                }

                const threadNos = [...threadNosSet];
                console.log(`Total selected threads: ${threadNos.length} from ${Math.min(maxPages, threadsData.length)} pages (current only)`);

                if (threadNos.length === 0) {
                    throw new Error('No threads found in the board. Board may be empty or invalid.');
                }

                // Fetch full posts cho từng thread, với context quoted thực tế
                for (const threadNo of threadNos) {
                    if (allPosts.length >= 500) break; // Tăng limit posts để nhiều hơn, cào toàn bộ
                    try {
                        const threadUrl = `https://a.4cdn.org/${board}/thread/${threadNo}.json`;
                        const threadRes = await fetchWithRetry(threadUrl, {
                            headers: { 'User-Agent': '4chan-scraper/1.0' }
                        });
                        const posts = threadRes.data.posts || [];

                        // Tạo map đầy đủ trước khi lọc/dedup để luôn tìm được post được reply.
                        const postMap = new Map(
                            posts
                                .filter(post => post?.no)
                                .map(post => [post.no, post])
                        );

                        for (let i = 0; i < posts.length; i++) {
                            const post = posts[i];
                            if (allPosts.length >= 500) break;
                            const subject = post.sub || '';
                            const comment = post.com || '';
                            const name = post.name || 'Anonymous';
                            const tim = post.tim;
                            const ext = post.ext;
                            const postNo = post.no;

                            let cleanContent = '';
                            let quotedPostId = null;
                            // Nếu có comment, clean nâng cao (full text)
                            if (comment && comment.trim()) {
                                const cleanSubject = cleanContentAdvanced(subject);
                                const cleanComment = cleanContentAdvanced(comment);
                                cleanContent = cleanSubject
                                    ? `[${cleanSubject}] ${cleanComment}`
                                    : cleanComment;
                                // THÊM: Log sample cleaned content cho debug (chỉ 1-2 posts/thread để tránh spam log)
                                if (i < 2) {
                                    debateDebug(`Cleaned sample for post ${postNo}: "${cleanContent.substring(0, 50)}..."`);
                                }
                            } else if (tim && ext) {
                                // Media-only: Content rỗng để chỉ gửi file, không text lạ
                                cleanContent = ''; // Rỗng, Discord sẽ gửi chỉ media
                            } else {
                                continue; // Skip nếu không có gì
                            }

                            // FIX: Skip nếu content rỗng VÀ không media
                            if (!cleanContent.trim() && !(tim && ext)) {
                                console.warn(`Skipping post with no content and no media from thread ${threadNo}`);
                                continue;
                            }

                            // 4chan trả link reply dưới dạng HTML/entity (&gt;&gt;123), nên phải decode trước khi parse.
                            const decodedComment = he.decode(comment || '');
                            const quoteMatch = decodedComment.match(/>>(\d+)/);
                            const isReply = !!quoteMatch;
                            if (isReply) {
                                quotedPostId = Number.parseInt(quoteMatch[1], 10);
                                if (postMap.has(quotedPostId)) {
                                    debateDebug(`Found reply from ${postNo} to ${quotedPostId} in thread ${threadNo}`);
                                } else {
                                    console.log(`Quoted post ${quotedPostId} is outside thread ${threadNo}; will reply to the previous Discord message`);
                                }
                            }

                            let mediaUrl = null;
                            let mediaName = null;
                            if (tim && ext) {
                                mediaUrl = `https://i.4cdn.org/${board}/${tim}${ext}`;
                                mediaName = `${tim}${ext}`;
                            }

                            // SỬA: Dedup mạnh hơn - ưu tiên check text hash nếu có content (skip nếu duplicate text, ngay cả media mới); sau đó check media nếu chưa skip
                            let skip = false;
                            let postHash = null;
                            if (cleanContent.trim()) {
                                const hashInput = cleanContent + name;
                                postHash = crypto.createHash('md5').update(hashInput).digest('hex');
                                if (seenPosts.has(postHash)) {
                                    debateDebug(`[DE DUP] Skipping duplicate text hash: ${postHash.substring(0, 8)} from thread ${threadNo}`);
                                    skip = true;
                                } else {
                                    seenPosts.add(postHash);
                                    newTextHashes.push(postHash);
                                    debateDebug(`[DE DUP] New text hash added: ${postHash.substring(0, 8)}`);
                                }
                            }
                            if (!skip && mediaUrl) {
                                if (seenMedia.has(mediaUrl)) {
                                    debateDebug(`[DE DUP] Skipping duplicate media URL: ${mediaUrl} from thread ${threadNo}`);
                                    skip = true;
                                } else {
                                    seenMedia.add(mediaUrl);
                                    newMediaUrls.push(mediaUrl);
                                    debateDebug(`[DE DUP] New media added: ${mediaUrl.substring(mediaUrl.lastIndexOf('/') + 1)}`);
                                }
                            }
                            if (skip) {
                                continue;
                            }

                            allPosts.push({
                                content: cleanContent,
                                author: name,
                                isReply: isReply,
                                quotedPostId: quotedPostId,
                                postId: postNo, // THÊM: ID của post hiện tại để lưu Discord msg ID
                                mediaUrl: mediaUrl,
                                mediaName: mediaName
                            });
                        }

                        // THÊM: Tăng delay giữa threads lên 2-3s để tránh rate-limit (post-hack stability)
                        await new Promise(resolve => setTimeout(resolve, 2000 + Math.random() * 1000));
                    } catch (threadErr) {
                        console.error(`Failed to fetch thread ${threadNo}:`, threadErr.message);
                        continue;
                    }
                }

                console.log(`Fetched ${allPosts.length} unique posts from /${board}/ (from ${threadNos.length} threads)`);
                if (allPosts.length === 0) {
                    throw new Error('No valid posts (with text or media) found in the selected threads. Try a different board.');
                }
                return { allPosts, newTextHashes, newMediaUrls };
            } catch (error) {
                console.error('Fetch 4chan posts failed:', error.message);
                if (error.code === 'ENOTFOUND' || error.message.includes('ENOTFOUND')) {
                    throw new Error(`Network error fetching /${board}/threads.json. Check internet connection.`);
                } else {
                    throw new Error(`Failed to fetch from /${board}/: ${error.message}. Check board name and try again.`);
                }
            }
        }

        // React bằng tài khoản khác để tránh tài khoản gửi tự tương tác với chính nó.
        async function handlePostReacts(currentClient, rolePlayChannelId, firstMsgId, postContent, hasMedia, postEmojiContext = true, roster = rolePlayRoster) {
            if (!firstMsgId) return;
            const normalizedPostContent = typeof postContent === 'string' ? postContent : '';
            const channel = currentClient.channels.cache.get(rolePlayChannelId);
            if (!channel) return;

            try {
                const activeClients = [rolePlayStarterClient, ...rolePlayParticipants]
                    .filter(candidate =>
                        candidate?.user?.id &&
                        roster?.has(candidate.user.id) &&
                        candidate.user.id !== currentClient.user.id &&
                        !failedClientIds.has(candidate.user.id) &&
                        candidate.channels.cache.has(rolePlayChannelId)
                    );
                if (activeClients.length === 0) return;

                const reactCount = hasMedia
                    ? Math.min(activeClients.length, Math.floor(Math.random() * 3) + 1)
                    : 1;
                const selectedReactors = shuffleArray(activeClients).slice(0, reactCount);

                for (let i = 0; i < selectedReactors.length; i++) {
                    const reactorClient = selectedReactors[i];
                    try {
                        const reactorChannel = reactorClient.channels.cache.get(rolePlayChannelId);
                        const reactorMsg = await reactorChannel.messages.fetch(firstMsgId);
                        const emoji =
                            i === 0 && postEmojiContext
                                ? getContextEmoji(normalizedPostContent || 'neutral', reactorChannel.guild)
                                : getRandomEmoji(reactorChannel.guild);
                        if (roster?.has(reactorClient.user.id)) await reactorMsg.react(emoji);
                        console.log(`Reactor ${reactorClient.user.username} reacted with: ${emoji}`);
                    } catch (reactErr) {
                        console.error(`React error from ${reactorClient.user.username}:`, reactErr.message);
                    }
                    await new Promise(resolve => setTimeout(resolve, 700 + Math.random() * 1100));
                }
            } catch (fetchErr) {
                console.error(`Failed to fetch message ${firstMsgId} for reacts:`, fetchErr.message);
            }
        }

        export async function execute(message, args, client) {
            const action = String(args[0] || '').toLowerCase();
            if (action === 'stop') {
                if (!rolePlayInterval && !rolePlayStarting) {
                    return 'ℹ️ Debate hiện không chạy.';
                }
                rolePlayStopRequested = true;
                rolePlayRunId += 1;
                finishDebate();
                return '⏹️ Debate đã dừng. Lệnh này độc lập với `!selfchatend`.';
            }
            if (action === 'status') {
                const status = getDebateStatus();
                if (!status.active) return 'ℹ️ Debate hiện không chạy.';
                return [
                    '📊 Debate đang chạy',
                    `Kênh: <#${status.channelId}>`,
                    `Board: /${status.board || '-'}/`,
                    `Bài: ${status.postIndex}/${status.totalPosts}`,
                    `Upload media: ${status.mediaUploadsAllowed ? 'bật' : 'tạm tắt do Discord giới hạn'}`
                ].join('\n');
            }

            if (rolePlayInterval || rolePlayStarting) {
                const reply = await message.channel.send('❌ Role play đang chạy! Dừng bot để bắt đầu mới.');
                setTimeout(() => {
                    message.delete().catch(() => {});
                    reply.delete().catch(() => {});
                }, 5000);
                return;
            }
            rolePlayStarting = true;
            rolePlayTurnRunning = false;
            rolePlayStopRequested = false;
            const runId = ++rolePlayRunId;
            postToDiscordMessage.clear();
            cycleCount = 0;
            sendCounts.clear();
            failedClientIds.clear();

            let board;
            const arg = args.length > 0 ? args[0].toLowerCase() : '';
            const isRandomAdult = arg === 'adult';
            const isRandomGeneral = arg === 'general';
            const isRandomAll = arg === '' || arg === 'random';
            if (isRandomAdult) {
                board = adultBoards[Math.floor(Math.random() * adultBoards.length)];
                console.log(`Random adult board selected: /${board}/`);
            } else if (isRandomGeneral) {
                board = generalBoards[Math.floor(Math.random() * generalBoards.length)];
                console.log(`Random general board selected: /${board}/`);
            } else if (isRandomAll) {
                board = allBoards[Math.floor(Math.random() * allBoards.length)];
                console.log(`Random all board selected: /${board}/`);
            } else {
                board = arg;
            }

            if (!/^[a-z0-9]+$/i.test(board)) {
                rolePlayStarting = false;
                const reply = await message.channel.send('❌ Tên board không hợp lệ.');
                setTimeout(() => reply.delete().catch(() => {}), 5000);
                return;
            }

            const targetChannelId = message.channel.id;
            const available = await findRoleplayParticipants(clients, targetChannelId);
            if (rolePlayStopRequested || runId !== rolePlayRunId) return;
            if (available.length < 2) {
                rolePlayStarting = false;
                return '❌ Cần ít nhất 2 tài khoản có quyền xem và gửi tin trong kênh này để role play.';
            }
            const connectedClients = available.map(participant => participant.client);
            const starterClient = connectedClients.find(candidate => candidate.user.id === client.user.id)
                || connectedClients[0];
            const currentActivity = getChannelActivity(targetChannelId);
            if (currentActivity && currentActivity.mode !== 'debate') {
                rolePlayStarting = false;
                const reply = await message.channel.send(
                    `❌ Kênh này đang chạy ${currentActivity.mode}. Hãy dừng chế độ đó trước khi bật debate.`
                );
                setTimeout(() => reply.delete().catch(() => {}), 7000);
                return;
            }
            if (!claimChannelActivity(targetChannelId, 'debate')) {
                rolePlayStarting = false;
                return;
            }
            rolePlayChannelId = targetChannelId;
            const roster = registerDebateRoster(
                targetChannelId, 'debate', connectedClients.map(candidate => candidate.user.id),
                () => {
                    rolePlayStopRequested = true;
                    rolePlayRunId += 1;
                    finishDebate();
                }
            );
            rolePlayRoster = roster;
            message.delete().catch(() => {});

            try {
                // Fetch posts từ board (random hoặc chỉ định) - SỬA: Nhận thêm newHashes
                const fetchResult = await fetch4chanPosts(board);
                if (rolePlayStopRequested || runId !== rolePlayRunId) return;
                postHistory = fetchResult.allPosts;
                let newTextHashes = fetchResult.newTextHashes;
                let newMediaUrls = fetchResult.newMediaUrls;
                currentBoard = board;
                // Xáo trộn nhưng vẫn giữ dependency: post gốc luôn đứng trước reply.
                postHistory = orderPostsForDebate(postHistory);
                currentPostIndex = 0;
                // Set participants: Tất cả clients trừ starter, shuffle để random thứ tự ban đầu
                rolePlayParticipants = connectedClients.filter(c => c.user.id !== starterClient.user.id);
                rolePlayParticipants = [...rolePlayParticipants].sort(() => Math.random() - 0.5); // Shuffle participants
                // THÊM MỚI: allActiveClients bao gồm starter để cân bằng toàn bộ
                const allActiveClients = [starterClient, ...rolePlayParticipants];
                // Nếu starter lỗi, thử tài khoản kế tiếp để session vẫn có thể bắt đầu.
                let announcementMessage = null;
                let announcementClient = null;
                const announcementText = `🤝 **Role play từ 4chan /${currentBoard}/ bắt đầu.**\nParticipants: ${allActiveClients.map(c => c.user.username).join(', ')}`;
                for (const announcementCandidate of [starterClient, ...rolePlayParticipants]) {
                    if (!roster.has(announcementCandidate.user.id)) continue;
                    const announcementChannel = announcementCandidate.channels.cache.get(targetChannelId);
                    if (!announcementChannel) {
                        failedClientIds.add(announcementCandidate.user.id);
                        console.error(`Skipping ${announcementCandidate.user.username}: channel ${targetChannelId} not found`);
                        continue;
                    }
                    try {
                        announcementMessage = await guardDebateChannel(
                            announcementChannel, roster, announcementCandidate.user.id
                        ).send(announcementText);
                        announcementClient = announcementCandidate;
                        break;
                    } catch (announcementErr) {
                        failedClientIds.add(announcementCandidate.user.id);
                        console.error(`Skipping ${announcementCandidate.user.username}: cannot send announcement:`, announcementErr.message);
                    }
                }
                if (rolePlayStopRequested || runId !== rolePlayRunId) return;
                if (!announcementMessage || !announcementClient) {
                    console.error('Cannot start debate: no account can send to the target channel');
                    return;
                }
                rolePlayStarterClient = starterClient;
                // Starter gửi post đầu tiên từ history
                let firstSenderClient = announcementClient;
                if (postHistory.length > 0) {
                    const firstPost = postHistory[0];
                    const firstReplyTarget =
                        (firstPost.isReply && firstPost.quotedPostId
                            ? postToDiscordMessage.get(firstPost.quotedPostId)
                            : null) ||
                        null;
                    let firstFiles = [];
                    if (firstPost.mediaUrl && mediaUploadsAllowed(targetChannelId)) {
                        const mediaBuffer = await downloadMedia(firstPost.mediaUrl);
                        if (rolePlayStopRequested || runId !== rolePlayRunId) return;
                        if (mediaBuffer) {
                            firstFiles = [{ attachment: mediaBuffer, name: firstPost.mediaName }];
                        }
                    }
                    if ((!firstPost.content || !firstPost.content.trim()) && firstFiles.length === 0) {
                        console.log(`Skipping first post ${firstPost.postId}: media could not be downloaded`);
                        currentPostIndex = 1;
                    } else {
                        let firstSendResult = null;
                        const firstCandidates = getBalancedClientCandidates(
                            allActiveClients,
                            new Set([
                                firstReplyTarget?.senderId || announcementClient.user.id
                            ])
                        );
                        for (const firstCandidate of firstCandidates) {
                            const result = await sendSplitMessage(
                                firstCandidate,
                                targetChannelId,
                                firstPost.content,
                                firstFiles,
                                firstReplyTarget,
                                roster
                            );
                            if (rolePlayStopRequested || runId !== rolePlayRunId) return;

                            if (result.mediaSkipped && !result.firstMsgId) {
                                console.warn(`Skipping media-only post ${firstPost.postId} while guild uploads are limited`);
                                break;
                            }
                            if (result.complete === false && result.clientFatal) {
                                failedClientIds.add(firstCandidate.user.id);
                                console.error(`Skipping ${firstCandidate.user.username}: account/access failure`);
                            } else if (result.complete === false && !result.success) {
                                console.warn(`Post ${firstPost.postId} failed for ${firstCandidate.user.username}; keeping account active`);
                            }
                            if (result.success && result.firstMsgId) {
                                firstSendResult = result;
                                firstSenderClient = firstCandidate;
                                break;
                            }
                        }
                        if (!firstSendResult) {
                            console.warn(`Skipping unsendable first post ${firstPost.postId}; debate will continue`);
                            failedClientIds.clear();
                            currentPostIndex = 1;
                        } else {
                            postToDiscordMessage.set(firstPost.postId, {
                                messageId: firstSendResult.firstMsgId,
                                senderId: firstSenderClient.user.id
                            });
                            sendCounts.set(firstSenderClient.user.id, (sendCounts.get(firstSenderClient.user.id) || 0) + 1);
                            await handlePostReacts(
                                firstSenderClient,
                                targetChannelId,
                                firstSendResult.firstMsgId,
                                firstPost.content,
                                !!firstPost.mediaUrl,
                                true,
                                roster
                            );
                            if (rolePlayStopRequested || runId !== rolePlayRunId) return;
                            currentPostIndex = 1; // Đã gửi index 0
                        }
                    }
                }
                if (rolePlayStopRequested || runId !== rolePlayRunId) return;
                // Set globals
                let previousSenderId = firstSenderClient.user.id; // Chỉ để đổi tài khoản gửi, không dùng làm reply target
                const randomMode = isRandomAdult
                    ? 'adult'
                    : isRandomGeneral
                        ? 'general'
                        : isRandomAll
                            ? 'all'
                            : 'custom';
                rolePlayInterval = setInterval(async () => {
                    if (runId !== rolePlayRunId) return;
                    if (rolePlayStopRequested) {
                        finishDebate();
                        return;
                    }
                    if (rolePlayTurnRunning) return;
                    rolePlayTurnRunning = true;
                    try {

                        if (currentPostIndex >= postHistory.length) {
                            cycleCount++; // Increment cycle
                            try {
                                // SỬA: Lưu chỉ newHashes từ fetch trước đó
                                await saveScrapedLog(currentBoard, newTextHashes, newMediaUrls);

                                postToDiscordMessage.clear();
                                sendCounts.clear(); // THÊM MỚI: Reset counts mỗi cycle để cân bằng mới

                                // THÊM: Expire old seen định kỳ (mỗi 10 cycles hoặc 10% random để fresh, tránh stale post-hack)
                                if (cycleCount % 10 === 0 || Math.random() < 0.1) {
                                    newTextHashes = []; // Reset new để force re-add
                                    newMediaUrls = [];
                                    console.log(`[CYCLE ${cycleCount}] Cleared old seen for freshness (post-hack stability)`);
                                }

                                let newBoard;
                                if (randomMode === 'adult') {
                                    newBoard = getRandomBoard(adultBoards, currentBoard);
                                    console.log(`[CYCLE ${cycleCount}] New adult board (diff from ${currentBoard}): /${newBoard}/`);
                                } else if (randomMode === 'general') {
                                    newBoard = getRandomBoard(generalBoards, currentBoard);
                                    console.log(`[CYCLE ${cycleCount}] New general board (diff from ${currentBoard}): /${newBoard}/`);
                                } else if (randomMode === 'custom') {
                                    newBoard = currentBoard;
                                    console.log(`[CYCLE ${cycleCount}] Refreshing custom board /${newBoard}/`);
                                } else {
                                    newBoard = getRandomBoard(allBoards, currentBoard);
                                    console.log(`[CYCLE ${cycleCount}] New all board (diff from ${currentBoard}): /${newBoard}/`);
                                }
                                const fetchResult = await fetch4chanPosts(newBoard); // SỬA: Nhận newHashes
                                const { allPosts: newPosts, newTextHashes: freshTextHashes, newMediaUrls: freshMediaUrls } = fetchResult;
                                if (newPosts.length > 0) {
                                    postHistory = orderPostsForDebate(newPosts);
                                    // Update newHashes cho save sau
                                    newTextHashes = freshTextHashes;
                                    newMediaUrls = freshMediaUrls;
                                    currentBoard = newBoard;
                                } else {
                                    // Nếu fetch mới fail, shuffle old nhưng filter seen (thực tế sẽ ít vì historical dedup)
                                    // SỬA: Filter consistent với logic dedup mới (text first, then media)
                                    const { seenPosts, seenMedia } = await loadHistoricalHashes();
                                    const filteredOld = postHistory.filter(post => {
                                        let shouldKeep = true;
                                        if (post.content && post.content.trim()) {
                                            const hashInput = post.content + (post.author || '');
                                            const postHash = crypto.createHash('md5').update(hashInput).digest('hex');
                                            if (seenPosts.has(postHash)) {
                                                shouldKeep = false;
                                            }
                                        }
                                        if (shouldKeep && post.mediaUrl) {
                                            if (seenMedia.has(post.mediaUrl)) {
                                                shouldKeep = false;
                                            }
                                        }
                                        return shouldKeep;
                                    });
                                    if (filteredOld.length > 0) {
                                        postHistory = orderPostsForDebate(filteredOld);
                                        // Giữ newHashes cũ vì không fetch mới
                                    } else {
                                        // Nếu hết, dừng interval
                                        finishDebate();
                                        return;
                                    }
                                }
                                currentPostIndex = 0;

                                return; // Exit lock chain
                            } catch (cycleErr) {
                                console.error('Cycle reset error:', cycleErr.message);
                                // Nếu error, shuffle filtered old tương tự
                                const { seenPosts, seenMedia } = await loadHistoricalHashes();
                                const filteredOld = postHistory.filter(post => {
                                    let shouldKeep = true;
                                    if (post.content && post.content.trim()) {
                                        const hashInput = post.content + (post.author || '');
                                        const postHash = crypto.createHash('md5').update(hashInput).digest('hex');
                                        if (seenPosts.has(postHash)) {
                                            shouldKeep = false;
                                        }
                                    }
                                    if (shouldKeep && post.mediaUrl) {
                                        if (seenMedia.has(post.mediaUrl)) {
                                            shouldKeep = false;
                                        }
                                    }
                                    return shouldKeep;
                                });
                                if (filteredOld.length > 0) {
                                    postHistory = orderPostsForDebate(filteredOld);
                                    currentPostIndex = 0;
                                    // Giữ reply chain dù phải dùng lại danh sách post cũ.
                                    // THÊM MỚI: Counts đã clear
                                } else {
                                    finishDebate();
                                    return;
                                }
                                return; // Exit lock chain
                            }
                        }
                        try {
                            const allActiveClients = [rolePlayStarterClient, ...rolePlayParticipants];
                            const currentPost = postHistory[currentPostIndex];
                            if (rolePlayStopRequested || runId !== rolePlayRunId) return;

                            if ((!currentPost.content || !currentPost.content.trim()) && !currentPost.mediaUrl) {
                                console.log(`Skipping post with no content and no media at index ${currentPostIndex}`);
                                currentPostIndex++;
                                return;
                            }

                            const quotedMessage =
                                currentPost.isReply && currentPost.quotedPostId
                                    ? postToDiscordMessage.get(currentPost.quotedPostId)
                                    : null;
                            // Chỉ reply/tag khi post 4chan thật sự trỏ tới một post đã gửi.
                            const replyTarget = quotedMessage || null;
                            if (currentPost.isReply && !quotedMessage) {
                                console.log(`Post ${currentPost.postId} references an unavailable 4chan post; sending without reply/tag`);
                            }

                            const response = currentPost.content; // Nội dung đã clean (có thể rỗng nếu chỉ media)
                            let msgFiles = [];
                            if (currentPost.mediaUrl && mediaUploadsAllowed(rolePlayChannelId)) {
                                const mediaBuffer = await downloadMedia(currentPost.mediaUrl);
                                if (rolePlayStopRequested || runId !== rolePlayRunId) return;
                                if (mediaBuffer) {
                                    msgFiles = [{ attachment: mediaBuffer, name: currentPost.mediaName }]; // Chỉ 1 file, không duplicate
                                }
                            }
                            if ((!response || !response.trim()) && msgFiles.length === 0) {
                                console.log(`Skipping post ${currentPost.postId}: media could not be downloaded`);
                                currentPostIndex++;
                                return;
                            }

                            let successfulClient = null;
                            let successfulSendResult = null;
                            const candidates = getBalancedClientCandidates(
                                allActiveClients,
                                new Set(replyTarget?.senderId ? [replyTarget.senderId] : [previousSenderId])
                            );

                            for (const currentClient of candidates) {
                                const sendResult = await sendSplitMessage(
                                    currentClient,
                                    rolePlayChannelId,
                                    response,
                                    msgFiles,
                                    replyTarget,
                                    roster
                                );
                                if (rolePlayStopRequested || runId !== rolePlayRunId) return;

                                if (sendResult.mediaSkipped && !sendResult.firstMsgId) {
                                    console.warn(`Skipping media-only post ${currentPost.postId} while guild uploads are limited`);
                                    break;
                                }
                                if (sendResult.complete === false && sendResult.clientFatal) {
                                    failedClientIds.add(currentClient.user.id);
                                    console.error(`Skipping ${currentClient.user.username}: account/access failure`);
                                } else if (sendResult.complete === false && !sendResult.success) {
                                    console.warn(`Post ${currentPost.postId} failed for ${currentClient.user.username}; keeping account active`);
                                }
                                if (sendResult.success && sendResult.firstMsgId) {
                                    successfulClient = currentClient;
                                    successfulSendResult = sendResult;
                                    break;
                                }
                            }

                            if (!successfulClient || !successfulSendResult) {
                                console.warn(`Skipping unsendable post ${currentPost.postId}; debate will continue`);
                                // Cho tài khoản lỗi được thử lại ở post tiếp theo thay vì làm chết toàn bộ phiên.
                                if (candidates.length === 0 || failedClientIds.size >= allActiveClients.length) {
                                    failedClientIds.clear();
                                }
                                currentPostIndex++;
                                return;
                            }

                            postToDiscordMessage.set(currentPost.postId, {
                                messageId: successfulSendResult.firstMsgId,
                                senderId: successfulClient.user.id
                            });
                            previousSenderId = successfulClient.user.id;
                            sendCounts.set(successfulClient.user.id, (sendCounts.get(successfulClient.user.id) || 0) + 1);
                            await handlePostReacts(
                                successfulClient,
                                rolePlayChannelId,
                                successfulSendResult.firstMsgId,
                                currentPost.content,
                                !!currentPost.mediaUrl,
                                true,
                                roster
                            );
                            if (rolePlayStopRequested || runId !== rolePlayRunId) return;
                            currentPostIndex++;
                        } catch (intervalErr) {
                            console.error('Interval error:', intervalErr.message);
                            // Bỏ post gây lỗi và giữ interval chạy cho lượt kế tiếp.
                            currentPostIndex++;
                            failedClientIds.clear();
                        }
                    } catch (turnErr) {
                        console.error('Unexpected debate turn error:', turnErr.message);
                    } finally {
                        if (runId === rolePlayRunId) rolePlayTurnRunning = false;
                    }
                }, 8000);
            } catch (fetchErr) {
                console.error('Setup role play failed:', fetchErr.message);
                const errorChannel = starterClient.channels.cache.get(targetChannelId);
                const errorMsg = roster.has(starterClient.user.id) && errorChannel
                    ? await guardDebateChannel(errorChannel, roster, starterClient.user.id)
                        .send(`❌ Lỗi lấy posts từ /${board}/: ${fetchErr.message}`).catch(() => null)
                    : null;
                setTimeout(() => errorMsg?.delete().catch(() => {}), 10000);
            } finally {
                if (runId !== rolePlayRunId) {
                    roster.close();
                } else {
                    rolePlayStarting = false;
                    if (!rolePlayInterval) {
                        roster.close();
                        if (rolePlayRoster === roster) rolePlayRoster = null;
                        releaseChannelActivity(targetChannelId, 'debate');
                        if (rolePlayChannelId === targetChannelId) rolePlayChannelId = null;
                    }
                }
            }
        }
