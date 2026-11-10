import {
    generateGeminiContent,
    getGeminiKeyStatus,
    getGroqKeyStatus,
    markGeminiGeneratedAuthor,
    markGeminiGeneratedMessage,
    resolvePersonality,
    setGeminiEnabled
} from './geminiMentionHandler.mjs';
import fs from 'fs';
import { findRoleplayParticipants } from './roleplayParticipants.mjs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
    extractContextTags,
    findStrongestRelationshipPair,
    getLearnedGifForContext,
    getPersistentAccountMemories,
    getPersistentChannelContext,
    getRelationshipContext,
    getSelfChatMemoryStats,
    learnGifMemory,
    markLearnedGifUsed,
    recordPersistentConversation
} from './selfChatMemoryStore.mjs';
import {
    claimChannelActivity,
    getChannelActivity,
    releaseChannelActivity
} from './channelActivityStore.mjs';

const sessions = new Map();
const handledCommandIds = new Map();
const observedMessageIds = new Map();
const observedChannelContexts = new Map();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MEDIA_DIRECTORY = path.join(__dirname, '../selfchat-media');
const MEDIA_CONFIG_PATH = path.join(__dirname, '../selfchat-media.json');
const SUPPORTED_MEDIA_EXTENSIONS = new Set([
    '.png', '.jpg', '.jpeg', '.gif', '.webp', '.mp4', '.webm', '.mov'
]);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.mov']);
const GENERIC_MEDIA_TAGS = new Set(['chung', 'random', 'meme', 'reaction']);
const MEDIA_CAPTIONS = {
    image: [
        'cái này đúng vibe nè',
        'nhìn cái này nhớ vụ nãy',
        'ảnh này hợp chủ đề phết',
        'coi cái này nè'
    ],
    video: [
        'coi khúc này nè',
        'đoạn này đúng cái đang nói',
        'video này hợp cảnh vl',
        'xem cái này buồn cười lắm'
    ]
};
const LEARNED_GIF_HOSTS = [
    'tenor.com',
    'media.tenor.com',
    'giphy.com',
    'media.giphy.com',
    'i.giphy.com',
    'cdn.discordapp.com',
    'media.discordapp.net'
];

const RANDOM_TOPICS = [
    'một món ăn gần đây khiến mọi người ấn tượng',
    'công nghệ nào sẽ hữu ích nhất trong vài năm tới',
    'một bộ phim hoặc bài hát đáng thử',
    'nơi mọi người muốn đi du lịch nhất',
    'thói quen nhỏ giúp một ngày dễ chịu hơn',
    'nếu được học ngay một kỹ năng mới thì sẽ chọn gì',
    'game nào vui hơn khi chơi cùng bạn bè',
    'một tình huống hài hước từng gặp trên mạng',
    'điều gì tạo nên một cuộc trò chuyện thú vị',
    'cuối tuần lý tưởng nên diễn ra như thế nào'
];

const CHAT_MICRO_STYLES = [
    'hơi cà khịa nhưng không ác ý, thích đáp gọn và bắt lỗi vui',
    'điềm tĩnh, hay hỏi lại một câu ngắn khi chưa rõ',
    'hài khô, đôi lúc đáp cụt nhưng vẫn đúng mạch',
    'dễ đồng cảm, thường công nhận ý người khác trước khi nói ý mình',
    'thực tế, không thích triết lý dài và hay kéo câu chuyện về chuyện đời thường',
    'tò mò, thích hỏi thêm chi tiết thay vì tự kết luận',
    'tinh nghịch, dùng slang vừa phải và biết dừng đúng lúc'
];

const CONVERSATION_MODES = [
    'đối đáp thân mật',
    'tranh luận nhẹ',
    'kể chuyện và hỏi thêm',
    'cà khịa vui',
    'chia sẻ trải nghiệm'
];

const CONVERSATION_ANGLES = [
    'đưa một ví dụ đời thường cụ thể thay vì tiếp tục kết luận chung',
    'nêu một trường hợp ngược lại hoặc ngoại lệ đáng chú ý',
    'hỏi về trải nghiệm thật của một người chưa nói nhiều',
    'chuyển sang chi tiết thú vị hoặc khó xử nhất của chủ đề',
    'đưa một ý kiến khác nhẹ nhàng để cuộc chat có điều trao đổi',
    'liên tưởng sang một tình huống vui nhưng vẫn liên quan',
    'nói một điều bản thân từng thử, từng thấy hoặc từng gặp',
    'đặt một câu hỏi giả định ngắn để mở nhánh mới'
];

const SEMANTIC_STOP_WORDS = new Set([
    'a', 'ai', 'anh', 'ban', 'bi', 'ca', 'cai', 'can', 'cho', 'co', 'cu', 'cua',
    'da', 'dang', 'de', 'di', 'do', 'duoc', 'gi', 'gio', 'hon', 'k', 'khong',
    'ko', 'la', 'lai', 'lam', 'ma', 'moi', 'mot', 'nao', 'nay', 'nhe', 'nhi',
    'nhung', 'no', 'noi', 'roi', 'sao', 'se', 'the', 'thi', 'tiep', 't', 'm',
    'toi', 'trong', 'tu', 'van', 've', 'voi', 'yeah', 'nha'
]);

function readInteger(name, fallback, min, max) {
    const parsed = Number.parseInt(process.env[name] ?? '', 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
}

function randomBetween(min, max) {
    return min + Math.floor(Math.random() * (max - min + 1));
}

function randomItem(items) {
    return items[Math.floor(Math.random() * items.length)];
}

function shuffled(items) {
    return [...items].sort(() => Math.random() - 0.5);
}

function hashText(value) {
    let hash = 0;
    for (const char of String(value || '')) {
        hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
    }
    return Math.abs(hash);
}

export function selectChatStyle(accountId) {
    const personality = resolvePersonality({
        user: { id: String(accountId || ''), username: String(accountId || '') }
    });
    return personality?.style
        || CHAT_MICRO_STYLES[hashText(accountId) % CHAT_MICRO_STYLES.length];
}

export function chooseConversationGroupSize(total, roll = Math.random()) {
    if (total <= 2) return total;
    if (roll < 0.25) return 2;
    if (roll < 0.65) return Math.min(3, total);
    if (roll < 0.9) return Math.min(4, total);
    return Math.min(5, total);
}

function refreshConversationScene(session) {
    const size = chooseConversationGroupSize(session.participants.length);
    const remaining = shuffled(session.participants);
    const selected = [];
    const previousActiveIds = new Set(session.activeParticipantIds || []);
    const strongestOverall = findStrongestRelationshipPair(
        session.participants.map(item => item.client.user.id)
    );
    if (strongestOverall && Math.random() < 0.6) {
        for (const id of strongestOverall.ids) {
            const participant = remaining.find(item => item.client.user.id === id);
            if (participant && selected.length < size) selected.push(participant);
        }
    }
    const previousSpeaker = remaining.find(item => item.client.user.id === session.lastSpeakerId);
    if (
        previousSpeaker
        && selected.length < size
        && !selected.includes(previousSpeaker)
        && Math.random() < 0.55
    ) {
        selected.push(previousSpeaker);
    }
    while (selected.length < size) {
        const available = remaining.filter(item => !selected.includes(item));
        if (available.length === 0) break;
        const fewestTurns = Math.min(...available.map(item => item.turns));
        const participant = weightedRandom(available, item => {
            const activity = personalityNumber(item, 'talkWeight', 1, 0.25, 2.5);
            const fairness = item.turns <= fewestTurns + 1 ? 1.35 : 1;
            const turnover = previousActiveIds.has(item.client.user.id) ? 0.55 : 2.2;
            return (0.45 + activity) * fairness * turnover;
        });
        selected.push(participant);
    }

    const rotatedSelection = ensureConversationTurnover(
        selected,
        session.participants,
        previousActiveIds
    );
    session.activeParticipantIds = new Set(rotatedSelection.map(item => item.client.user.id));
    session.sceneGeneration = (session.sceneGeneration || 0) + 1;
    session.sceneMode = size === 2 && Math.random() < 0.6
        ? randomItem(['đối đáp thân mật', 'tranh luận nhẹ', 'cà khịa vui'])
        : randomItem(CONVERSATION_MODES);
    const strongestSelected = findStrongestRelationshipPair(
        rotatedSelection.map(item => item.client.user.id)
    );
    if (strongestSelected && Math.random() < 0.55) {
        if (['khắc khẩu', 'đang căng thẳng'].includes(strongestSelected.label)) {
            session.sceneMode = randomItem(['tranh luận nhẹ', 'cà khịa vui']);
        } else if (
            ['bạn thân', 'có cảm tình đặc biệt', 'gắn bó như người yêu']
                .includes(strongestSelected.label)
        ) {
            session.sceneMode = randomItem(['đối đáp thân mật', 'chia sẻ trải nghiệm']);
        }
    }
    session.stances = new Map();
    if (session.sceneMode === 'tranh luận nhẹ') {
        rotatedSelection.forEach((participant, index) => {
            session.stances.set(
                participant.client.user.id,
                index % 2 === 0 ? 'nghiêng về đồng ý' : 'nghiêng về không đồng ý'
            );
        });
    }

    const focusSize = Math.min(rotatedSelection.length, rotatedSelection.length >= 4 ? 3 : 2);
    const focusParticipants = [];
    if (strongestSelected && Math.random() < 0.7) {
        for (const id of strongestSelected.ids) {
            const participant = rotatedSelection.find(item => item.client.user.id === id);
            if (participant && focusParticipants.length < focusSize) {
                focusParticipants.push(participant);
            }
        }
    }
    while (focusParticipants.length < focusSize) {
        const available = rotatedSelection.filter(item => !focusParticipants.includes(item));
        if (available.length === 0) break;
        focusParticipants.push(weightedRandom(
            available,
            item => personalityNumber(item, 'talkWeight', 1, 0.25, 2.5)
        ));
    }
    session.focusParticipantIds = new Set(
        focusParticipants.map(item => item.client.user.id)
    );

    const useSpotlight = rotatedSelection.length >= 2
        && (session.sceneMode === 'cà khịa vui' || Math.random() < 0.28);
    const spotlight = useSpotlight
        ? weightedRandom(
            rotatedSelection,
            item => personalityNumber(item, 'spotlightWeight', 1, 0.2, 3)
        )
        : null;
    session.spotlightParticipantId = spotlight?.client?.user?.id || null;
    session.nextSceneTurn = session.turn + randomBetween(6, 10);
}

export function ensureConversationTurnover(
    selected,
    participants,
    previousActiveIds,
    roll = Math.random()
) {
    if (
        !previousActiveIds?.size
        || selected.length === 0
        || selected.some(item => !previousActiveIds.has(item.client.user.id))
    ) {
        return selected;
    }

    const outsiders = participants.filter(item =>
        !previousActiveIds.has(item.client.user.id)
        && !selected.includes(item)
    );
    if (outsiders.length === 0) return selected;
    const fewestTurns = Math.min(...outsiders.map(item => item.turns));
    const preferred = outsiders.filter(item => item.turns <= fewestTurns + 1);
    const newcomer = preferred[Math.min(
        preferred.length - 1,
        Math.floor(Math.max(0, roll) * preferred.length)
    )];
    return [...selected.slice(0, -1), newcomer];
}

function personalityNumber(speaker, key, fallback, min, max) {
    const value = Number(speaker?.personality?.[key]);
    if (!Number.isFinite(value)) return fallback;
    return Math.min(max, Math.max(min, value));
}

function weightedRandom(items, weightSelector, roll = Math.random()) {
    if (items.length <= 1) return items[0] || null;
    const weights = items.map(item => Math.max(0.01, Number(weightSelector(item)) || 0.01));
    const total = weights.reduce((sum, value) => sum + value, 0);
    let cursor = roll * total;
    for (let index = 0; index < items.length; index++) {
        cursor -= weights[index];
        if (cursor <= 0) return items[index];
    }
    return items[items.length - 1];
}

function cleanText(value, maxLength = 500) {
    return String(value || '')
        .replace(/@everyone/gi, 'everyone')
        .replace(/@here/gi, 'here')
        .replace(/<@!?\d+>/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, maxLength);
}

function stripUrls(value) {
    return String(value || '').replace(/https?:\/\/\S+/gi, '').replace(/\s+/g, ' ').trim();
}

function normalizeMediaText(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .replace(/đ/gi, 'd')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function listMediaFiles(directory) {
    if (!fs.existsSync(directory)) return [];
    const files = [];
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const absolutePath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            files.push(...listMediaFiles(absolutePath));
        } else if (SUPPORTED_MEDIA_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
            files.push(absolutePath);
        }
    }
    return files;
}

function readMediaConfig() {
    try {
        if (!fs.existsSync(MEDIA_CONFIG_PATH)) return { items: [] };
        const parsed = JSON.parse(fs.readFileSync(MEDIA_CONFIG_PATH, 'utf8'));
        return {
            items: Array.isArray(parsed?.items) ? parsed.items : []
        };
    } catch (error) {
        console.warn(`[SELFCHAT] Không đọc được selfchat-media.json: ${error.message}`);
        return { items: [] };
    }
}

function tagsFromFilename(filePath) {
    return normalizeMediaText(path.basename(filePath, path.extname(filePath)))
        .split(' ')
        .filter(word => word.length >= 2);
}

export function loadSelfChatMediaLibrary() {
    const maxBytes = readInteger(
        'SELFCHAT_MEDIA_MAX_BYTES',
        8_000_000,
        100_000,
        25_000_000
    );
    const config = readMediaConfig();
    const configuredByFile = new Map(
        config.items
            .filter(item => item && typeof item.file === 'string')
            .map(item => [
                item.file.replace(/\\/g, '/').toLowerCase(),
                item
            ])
    );

    return listMediaFiles(MEDIA_DIRECTORY).flatMap(absolutePath => {
        const relativePath = path.relative(MEDIA_DIRECTORY, absolutePath).replace(/\\/g, '/');
        const configured = configuredByFile.get(relativePath.toLowerCase()) || {};
        if (configured.enabled === false) return [];

        let size;
        try {
            size = fs.statSync(absolutePath).size;
        } catch (_) {
            return [];
        }
        if (size <= 0 || size > maxBytes) return [];

        const extension = path.extname(absolutePath).toLowerCase();
        const configuredTags = Array.isArray(configured.tags)
            ? configured.tags.map(normalizeMediaText).filter(Boolean)
            : [];
        const captions = Array.isArray(configured.captions)
            ? configured.captions.map(value => cleanText(value, 100)).filter(Boolean)
            : [];
        return [{
            id: relativePath.toLowerCase(),
            absolutePath,
            relativePath,
            type: VIDEO_EXTENSIONS.has(extension) ? 'video' : 'image',
            tags: [...new Set([...configuredTags, ...tagsFromFilename(relativePath)])],
            captions,
            size
        }];
    });
}

export function selectContextualMedia(
    items,
    context,
    usedIds = new Set(),
    roll = Math.random()
) {
    if (!Array.isArray(items) || items.length === 0) return null;
    const unused = items.filter(item => !usedIds.has(item.id));
    const pool = unused.length > 0 ? unused : items;
    const normalizedContext = ` ${normalizeMediaText(context)} `;
    const scored = pool.map(item => {
        const matches = (item.tags || []).filter(tag =>
            tag && normalizedContext.includes(` ${normalizeMediaText(tag)} `)
        ).length;
        const generic = (item.tags || []).some(tag =>
            GENERIC_MEDIA_TAGS.has(normalizeMediaText(tag))
        );
        return { item, score: matches * 3 + (generic ? 1 : 0) };
    });
    const bestScore = Math.max(...scored.map(entry => entry.score));
    if (bestScore <= 0) return null;
    const candidates = scored.filter(entry => entry.score === bestScore).map(entry => entry.item);
    return candidates[Math.min(candidates.length - 1, Math.floor(roll * candidates.length))];
}

function mediaContext(session) {
    return [
        session.topic,
        ...session.recentMessages.slice(-6).map(item => stripUrls(item.content))
    ].join(' ');
}

export function shouldSendMedia(
    session,
    speaker,
    isExpectedResponse,
    hasContextualMedia,
    roll = Math.random()
) {
    if (isExpectedResponse || !hasContextualMedia || session.turn < 6) return false;
    const cooldown = readInteger('SELFCHAT_MEDIA_COOLDOWN_TURNS', 28, 12, 100);
    if (session.turn - (session.lastMediaTurn ?? -100) < cooldown) return false;
    const baseChance = readInteger('SELFCHAT_MEDIA_CHANCE_PERCENT', 3, 0, 12);
    const activity = personalityNumber(speaker, 'talkWeight', 1, 0.25, 2.5);
    const chance = Math.min(8, baseChance * (0.75 + activity * 0.25));
    return roll * 100 < chance;
}

function isAllowedLearnedGifUrl(value) {
    try {
        const url = new URL(String(value || ''));
        if (!['https:', 'http:'].includes(url.protocol)) return false;
        const hostname = url.hostname.toLowerCase();
        return LEARNED_GIF_HOSTS.some(host =>
            hostname === host || hostname.endsWith(`.${host}`)
        );
    } catch (_) {
        return false;
    }
}

function gifProvider(url) {
    const normalized = String(url || '').toLowerCase();
    if (normalized.includes('tenor')) return 'tenor';
    if (normalized.includes('giphy')) return 'giphy';
    if (normalized.includes('discordapp') || normalized.includes('discord.net')) {
        return 'discord';
    }
    return 'other';
}

export function extractDiscordGifCandidate(message) {
    const attachments = Array.from(message?.attachments?.values?.() || []);
    for (const attachment of attachments) {
        const url = attachment?.url;
        const filename = String(attachment?.name || attachment?.filename || '').toLowerCase();
        const contentType = String(attachment?.contentType || attachment?.content_type || '')
            .toLowerCase();
        if (
            isAllowedLearnedGifUrl(url)
            && (filename.endsWith('.gif') || contentType === 'image/gif')
        ) {
            return { url, provider: gifProvider(url) };
        }
    }

    const embeds = Array.isArray(message?.embeds)
        ? message.embeds
        : Array.from(message?.embeds?.values?.() || []);
    for (const embed of embeds) {
        if (String(embed?.type || '').toLowerCase() !== 'gifv') continue;
        const candidates = [
            embed?.url,
            embed?.video?.url,
            embed?.image?.url,
            embed?.thumbnail?.url
        ];
        const url = candidates.find(isAllowedLearnedGifUrl);
        if (url) return { url, provider: gifProvider(url) };
    }

    const urls = String(message?.content || '').match(/https?:\/\/[^\s<>]+/gi) || [];
    const url = urls.find(isAllowedLearnedGifUrl);
    return url ? { url, provider: gifProvider(url) } : null;
}

function rememberObservedMessage(messageId) {
    const now = Date.now();
    for (const [id, expiresAt] of observedMessageIds) {
        if (expiresAt <= now) observedMessageIds.delete(id);
    }
    const id = String(messageId || '');
    if (!id || observedMessageIds.has(id)) return false;
    observedMessageIds.set(id, now + 10 * 60 * 1000);
    while (observedMessageIds.size > 5000) {
        observedMessageIds.delete(observedMessageIds.keys().next().value);
    }
    return true;
}

function rememberObservedContext(channelId, content) {
    const cleaned = cleanText(stripUrls(content), 220);
    if (!cleaned) return;
    if (!observedChannelContexts.has(channelId) && observedChannelContexts.size >= 200) {
        observedChannelContexts.delete(observedChannelContexts.keys().next().value);
    }
    const context = observedChannelContexts.get(channelId) || [];
    context.push(cleaned);
    if (context.length > 8) context.shift();
    observedChannelContexts.set(channelId, context);
}

export function observeGifForSelfChat(message, clients) {
    if (!message?.id || !message?.channel?.id || !message?.author?.id) return false;
    if (!rememberObservedMessage(message.id)) return false;
    if (isManagedAuthor(message, clients)) return false;

    const channelId = String(message.channel.id);
    const candidate = extractDiscordGifCandidate(message);
    if (!candidate) {
        rememberObservedContext(channelId, message.content);
        return false;
    }

    const contextParts = [
        ...(observedChannelContexts.get(channelId) || []).slice(-6),
        cleanText(stripUrls(message.content), 180)
    ].filter(Boolean);
    const context = contextParts.join(' ');
    const tags = extractContextTags(context);
    learnGifMemory({
        url: candidate.url,
        provider: candidate.provider,
        tags: tags.length > 0 ? tags : ['reaction', 'meme'],
        context
    });
    return true;
}

const EMOJI_PATTERN = /\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?)*/gu;

export function stripSelfChatEmojis(value) {
    return String(value || '')
        .replace(EMOJI_PATTERN, '')
        .replace(/[\uFE0F\u200D]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function stripEmojisPreservingLines(value) {
    return String(value || '')
        .replace(EMOJI_PATTERN, '')
        .replace(/[\uFE0F\u200D]/g, '')
        .replace(/\r/g, '')
        .split('\n')
        .map(line => line
            .replace(/@everyone/gi, 'everyone')
            .replace(/@here/gi, 'here')
            .replace(/<@!?\d+>/g, '')
            .replace(/^\s*(?:[-*#>]|\d+[.)])\s*/, '')
            .replace(/\s+/g, ' ')
            .trim())
        .filter(Boolean)
        .join('\n');
}

export function shortenSelfChatText(value, maxLength = 110) {
    let text = cleanText(value, 1000);
    const firstSentence = text.match(/^(.{8,}?[.!?…])(?=\s|$)/);
    if (firstSentence && firstSentence[1].length < text.length) text = firstSentence[1];

    const words = text.split(/\s+/);
    if (words.length > 16) text = `${words.slice(0, 16).join(' ')}…`;
    if (text.length <= maxLength) return text;

    const sentence = text.slice(0, maxLength + 1).match(/^(.{20,}?[.!?…])(?:\s|$)/);
    if (sentence) return sentence[1].trim();

    const shortened = text.slice(0, maxLength + 1);
    const lastSpace = shortened.lastIndexOf(' ');
    return `${shortened.slice(0, lastSpace > 40 ? lastSpace : maxLength).trimEnd()}…`;
}

function splitIntoNaturalLines(value, wordsPerLine, maxLines) {
    const existingLines = value.split('\n').map(line => line.trim()).filter(Boolean);
    if (existingLines.length >= 2) return existingLines.slice(0, maxLines);

    const sentences = value.split(/(?<=[.!?…])\s+/).map(line => line.trim()).filter(Boolean);
    if (sentences.length >= 2) return sentences.slice(0, maxLines);

    const words = value.split(/\s+/).filter(Boolean);
    const lines = [];
    for (let index = 0; index < words.length && lines.length < maxLines; index += wordsPerLine) {
        lines.push(words.slice(index, index + wordsPerLine).join(' '));
    }
    return lines;
}

export function formatLongSelfChatText(value) {
    const clean = stripEmojisPreservingLines(value) || 'chịu';
    const limitedWords = clean.split(/\s+/).slice(0, 96).join(' ');
    const source = clean.includes('\n') ? clean : limitedWords;
    const lines = splitIntoNaturalLines(source, 14, 6)
        .map(line => line.slice(0, 180).trim())
        .filter(Boolean);
    return lines.slice(0, 6).join('\n').slice(0, 850).trim();
}

function formatMediumSelfChatText(value) {
    const clean = stripEmojisPreservingLines(value) || 'chịu';
    const words = clean.replace(/\n/g, ' ').split(/\s+/).slice(0, 38).join(' ');
    const lines = splitIntoNaturalLines(words, 19, 2);
    return lines.join('\n').slice(0, 320).trim();
}

export function chooseMessageLengthMode(
    session,
    isExpectedResponse = false,
    roll = Math.random(),
    speaker = null
) {
    const verbosityBonus = personalityNumber(
        speaker,
        'longChanceBonus',
        0,
        -12,
        18
    );
    const mediumChance = Math.max(
        5,
        readInteger('SELFCHAT_MEDIUM_MESSAGE_CHANCE_PERCENT', 22, 0, 50)
            + Math.round(verbosityBonus / 2)
    );
    const configuredLongChance = readInteger('SELFCHAT_LONG_MESSAGE_CHANCE_PERCENT', 10, 0, 30);
    const longChance = Math.max(
        0,
        configuredLongChance
            + (session.sceneMode === 'tranh luận nhẹ' ? 4 : 0)
            + verbosityBonus
    );
    const longCooldownPassed = session.turn - (session.lastLongTurn ?? -20) >= 8;
    const canSendLong = !isExpectedResponse && session.recentMessages.length >= 3 && longCooldownPassed;

    if (canSendLong && roll * 100 < longChance) return 'long';
    const mediumThreshold = mediumChance + (canSendLong ? longChance : 0);
    if (roll * 100 < mediumThreshold) return 'medium';
    return 'short';
}

function normalizedWords(value) {
    return stripSelfChatEmojis(value)
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .split(' ')
        .filter(Boolean);
}

function foldVietnamese(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd')
        .replace(/Đ/g, 'D')
        .toLowerCase();
}

function canonicalSemanticToken(word) {
    const token = foldVietnamese(word).replace(/[^\p{L}\p{N}]/gu, '');
    if (!token || token.length < 2 || SEMANTIC_STOP_WORDS.has(token)) return null;
    if (/^(plan|kehoach|phuongan|timeline|action|trienkhai|apdung)/.test(token)) return 'planning';
    if (/^(track|theodoi|giamsat|tiendo|review|report|ketqua|bamsat)/.test(token)) return 'progress';
    if (/^(dongy|chot|chuẩn|chuan|okay|ok)$/.test(token)) return 'agreement';
    if (/^(vidu|truonghop|trainghiem|tunggap)/.test(token)) return 'example';
    if (/^(nguoilai|nguoclai|phanbien|khongdongy)/.test(token)) return 'contrast';
    return token;
}

function semanticTokens(value) {
    return foldVietnamese(stripSelfChatEmojis(value))
        .replace(/\bke\s+hoach\b/g, ' planning ')
        .replace(/\bphuong\s+an\b/g, ' planning ')
        .replace(/\btrien\s+khai\b/g, ' planning ')
        .replace(/\bap\s+dung\b/g, ' planning ')
        .replace(/\btheo\s+doi\b/g, ' progress ')
        .replace(/\bgiam\s+sat\b/g, ' progress ')
        .replace(/\btien\s+do\b/g, ' progress ')
        .replace(/\bket\s+qua\b/g, ' progress ')
        .replace(/\bbam\s+sat\b/g, ' progress ')
        .replace(/\bdong\s+y\b/g, ' agreement ')
        .replace(/\bvi\s+du\b/g, ' example ')
        .replace(/\bnguoc\s+lai\b/g, ' contrast ')
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .split(/\s+/)
        .map(canonicalSemanticToken)
        .filter(Boolean);
}

function classifySelfChatMove(value) {
    const text = foldVietnamese(value).trim();
    if (/^(u|um|uhm|ok|okay|dung|chuan|chot|neu the|tot roi|cu|dc|duoc)(?:\s|[,!.]|$)/.test(text)) {
        return 'acknowledgement';
    }
    if (/[?？]\s*$/.test(text) || /^(sao|tai sao|the neu|con neu|m nghi|ban nghi)/.test(text)) {
        return 'question';
    }
    if (/\b(vi du|tung gap|tung thay|lan truoc|co lan)\b/.test(text)) return 'example';
    if (/\b(nhung|ma khoan|khong chac|nguoc lai|t thay khac|hoi can)\b/.test(text)) return 'contrast';
    if (/\b(nen|thu|hay|can|ke hoach|phuong an|plan|action)\b/.test(text)) return 'proposal';
    return 'statement';
}

export function getRepeatedSelfChatTerms(recentMessages, minCount = 3) {
    const messageCounts = new Map();
    for (const message of recentMessages.slice(-8)) {
        const uniqueTokens = new Set(semanticTokens(message.content));
        for (const token of uniqueTokens) {
            messageCounts.set(token, (messageCounts.get(token) || 0) + 1);
        }
    }
    return [...messageCounts.entries()]
        .filter(([, count]) => count >= minCount)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([token]) => token);
}

function semanticSimilarity(first, second) {
    const firstSet = new Set(semanticTokens(first));
    const secondSet = new Set(semanticTokens(second));
    if (firstSet.size === 0 || secondSet.size === 0) return 0;
    const intersection = [...firstSet].filter(token => secondSet.has(token)).length;
    return intersection / Math.min(firstSet.size, secondSet.size);
}

export function isStagnantSelfChatReply(content, recentMessages) {
    if (isNearDuplicateSelfChat(content, recentMessages)) return true;
    const recent = recentMessages.slice(-5);
    const move = classifySelfChatMove(content);
    const sameMoveCount = recent.filter(item =>
        classifySelfChatMove(item.content) === move
    ).length;
    if (move === 'acknowledgement' && sameMoveCount >= 2) return true;

    const highSimilarityCount = recent.filter(item =>
        semanticSimilarity(content, item.content) >= 0.62
    ).length;
    return highSimilarityCount >= 2;
}

export function hasLongPairStreak(recentMessages, maxTurns = 6) {
    const window = recentMessages.slice(-maxTurns);
    if (window.length < maxTurns) return false;
    const authors = new Set(window.map(item => item.authorId).filter(Boolean));
    return authors.size > 0 && authors.size <= 2;
}

function chooseConversationAngle(session) {
    const recentAngles = new Set((session.recentConversationAngles || []).slice(-3));
    const available = CONVERSATION_ANGLES.filter(angle => !recentAngles.has(angle));
    const angle = randomItem(available.length > 0 ? available : CONVERSATION_ANGLES);
    session.recentConversationAngles.push(angle);
    if (session.recentConversationAngles.length > 5) session.recentConversationAngles.shift();
    return angle;
}

function semanticTermLabel(term) {
    return {
        planning: 'lập kế hoạch',
        progress: 'theo dõi tiến độ',
        agreement: 'đồng ý/chốt',
        example: 'ví dụ',
        contrast: 'ý ngược lại'
    }[term] || term;
}

export function isNearDuplicateSelfChat(content, recentMessages) {
    const words = normalizedWords(content);
    if (words.length === 0) return false;
    const normalized = words.join(' ');

    return recentMessages.slice(-8).some(message => {
        const previousWords = normalizedWords(message.content);
        if (previousWords.length === 0) return false;
        const previous = previousWords.join(' ');
        if (normalized === previous) return true;

        const currentSet = new Set(words);
        const previousSet = new Set(previousWords);
        const intersection = [...currentSet].filter(word => previousSet.has(word)).length;
        const union = new Set([...currentSet, ...previousSet]).size;
        return union > 0 && intersection / union >= 0.78;
    });
}

export function detectSelfChatLoop(recentMessages) {
    const window = recentMessages.slice(-6);
    if (window.length < 6) return false;
    const authors = new Set(window.map(item => item.authorId).filter(Boolean));
    if (authors.size > 2) return false;

    const moveCounts = new Map();
    for (const item of window) {
        const move = classifySelfChatMove(item.content);
        moveCounts.set(move, (moveCounts.get(move) || 0) + 1);
    }
    const acknowledgementCount = moveCounts.get('acknowledgement') || 0;
    const dominantMoveCount = Math.max(...moveCounts.values());
    const repeatedTerms = getRepeatedSelfChatTerms(window, 3);
    let stagnantTransitions = 0;
    for (let index = 1; index < window.length; index++) {
        if (semanticSimilarity(window[index - 1].content, window[index].content) >= 0.45) {
            stagnantTransitions += 1;
        }
    }

    return acknowledgementCount >= 4
        || (
            dominantMoveCount >= 5
            && repeatedTerms.length >= 2
            && stagnantTransitions >= 3
        );
}

export function parseSelfChatCommand(content) {
    const text = String(content || '').trim();
    if (/^!offall\s*$/i.test(text)) return { type: 'offall' };
    if (/^!selfchatstatus\s*$/i.test(text)) return { type: 'status' };
    if (/^!selfchatquota\s*$/i.test(text)) return { type: 'quota' };
    if (/^!selfchatmemory\s*$/i.test(text)) return { type: 'memory' };
    if (/^!selfchatend\s*$/i.test(text)) return { type: 'end' };
    const match = text.match(/^!selfchat(?:\s+([\s\S]+))?$/i);
    if (!match) return null;
    const topic = cleanText(match[1] || '', 300);
    return { type: 'start', topic: topic || null };
}

function rememberCommand(messageId) {
    const now = Date.now();
    for (const [id, expiresAt] of handledCommandIds) {
        if (expiresAt <= now) handledCommandIds.delete(id);
    }
    if (handledCommandIds.has(String(messageId))) return false;
    handledCommandIds.set(String(messageId), now + 10 * 60 * 1000);
    return true;
}

function isManagedAuthor(message, clients) {
    return clients.some(client => String(client?.user?.id || '') === String(message?.author?.id || ''));
}

async function getChannelForClient(client, channelId) {
    const cached = client.channels?.cache?.get(channelId);
    if (cached?.send) return cached;
    try {
        const fetched = await client.channels?.fetch?.(channelId);
        return fetched?.send ? fetched : null;
    } catch (_) {
        return null;
    }
}

async function findParticipants(clients, channelId) {
    const available = await findRoleplayParticipants(clients, channelId);
    return available.map(({ client, channel }) => {
        const personality = resolvePersonality(client);
        return {
            client,
            channel,
            personality,
            chatStyle: personality?.style || selectChatStyle(client.user.id),
            turns: 0,
            failures: 0,
            blockedUntil: 0
        };
    });
}

function hydrateAccountMemories(participants) {
    return new Map(
        participants.map(participant => [
            participant.client.user.id,
            getPersistentAccountMemories(participant.client.user.id, 3)
        ])
    );
}

export function chooseSpeaker(session) {
    const now = Date.now();
    const healthy = session.participants.filter(item => (item.blockedUntil || 0) <= now);
    const pool = healthy.length > 0 ? healthy : session.participants;

    if (session.expectedSpeakerId) {
        const expected = pool.find(item => item.client.user.id === session.expectedSpeakerId);
        if (expected && expected.client.user.id !== session.lastSpeakerId) return expected;
        session.expectedSpeakerId = null;
    }

    const activePool = pool.filter(item => session.activeParticipantIds?.has(item.client.user.id));
    const speakingPool = activePool.length >= 2 ? activePool : pool;
    const withoutPrevious = speakingPool.filter(item => item.client.user.id !== session.lastSpeakerId);
    const candidates = withoutPrevious.length > 0 ? withoutPrevious : speakingPool;
    return weightedRandom(candidates, item => getSpeakerWeight(session, item));
}

export function getSpeakerWeight(session, speaker) {
    const activity = personalityNumber(speaker, 'talkWeight', 1, 0.25, 2.5);
    const participantId = speaker.client.user.id;
    const focusBonus = session.focusParticipantIds?.has(participantId) ? 1.65 : 1;
    const spotlightBonus = session.spotlightParticipantId === participantId ? 1.3 : 1;
    const fewestTurns = Math.min(...session.participants.map(item => item.turns));
    const fairnessBonus = speaker.turns <= fewestTurns + 1 ? 1.18 : 1;
    return activity * focusBonus * spotlightBonus * fairnessBonus;
}

function chooseReplyTarget(session, speaker) {
    const speakerId = speaker.client.user.id;
    const configuredChance = readInteger('SELFCHAT_REPLY_CHANCE_PERCENT', 18, 0, 100);
    const chance = personalityNumber(
        speaker,
        'replyChance',
        configuredChance,
        0,
        45
    );
    if (Math.random() * 100 >= chance) return null;
    const options = session.recentMessages
        .filter(item => item.authorId !== speakerId)
        .slice(-5);
    if (options.length === 0) return null;
    return Math.random() < 0.7 ? options[options.length - 1] : randomItem(options);
}

function getRecentTarget(session, speakerId) {
    return session.recentMessages
        .filter(item => item.authorId !== speakerId && item.id)
        .slice(-1)[0] || null;
}

export function nextExpectedSpeakerAfterTurn(isExpectedResponse, replyTarget) {
    if (isExpectedResponse) return null;
    return replyTarget?.authorId || null;
}

function contextualEmoji(text, session) {
    const normalized = String(text || '').toLowerCase();
    let candidates;
    if (/buồn|khóc|chết|mệt|thất tình|xin lỗi/.test(normalized)) candidates = ['😭', '🥲', '😔'];
    else if (/hay|đỉnh|ngon|chuẩn|đúng|xịn|tuyệt/.test(normalized)) candidates = ['👍', '🔥', '👌'];
    else if (/sao|gì|hả|thật à|ủa/.test(normalized)) candidates = ['🤨', '🤔', '👀'];
    else if (/haha|hài|vl|vcl|xàm|ngáo/.test(normalized)) candidates = ['😂', '💀', '🤣'];
    else candidates = ['😂', '💀', '👀', '👍', '🤨', '😭'];

    const recentlyUsed = new Set(session.recentEmojis.slice(-8));
    const available = candidates.filter(emoji => !recentlyUsed.has(emoji));
    return available.length > 0 ? randomItem(available) : null;
}

function rememberEmojiUsage(session, emoji) {
    if (!emoji) return;
    session.recentEmojis.push(emoji);
    if (session.recentEmojis.length > 8) session.recentEmojis.shift();
}

function finalizeGeneratedText(value, session, lengthMode) {
    const withoutModelEmoji = stripEmojisPreservingLines(
        String(value || '').replace(/https?:\/\/\S+/gi, '')
    ) || 'chịu';
    const base = lengthMode === 'long'
        ? formatLongSelfChatText(withoutModelEmoji)
        : lengthMode === 'medium'
            ? formatMediumSelfChatText(withoutModelEmoji)
            : shortenSelfChatText(withoutModelEmoji, 100);
    const chance = readInteger('SELFCHAT_TEXT_EMOJI_CHANCE_PERCENT', 6, 0, 25);
    if (Math.random() * 100 >= chance) return base;

    const emoji = contextualEmoji(base, session);
    if (!emoji) return base;
    rememberEmojiUsage(session, emoji);
    return `${base} ${emoji}`;
}

function chooseInteractionType(session, speakerId) {
    if (session.recentMessages.length === 0) return 'text';
    const roll = Math.random() * 100;
    const reactionChance = readInteger('SELFCHAT_REACTION_CHANCE_PERCENT', 12, 0, 40);
    const stickerChance = readInteger('SELFCHAT_STICKER_CHANCE_PERCENT', 5, 0, 25);
    const emojiChance = readInteger('SELFCHAT_EMOJI_MESSAGE_CHANCE_PERCENT', 6, 0, 25);
    if (roll < reactionChance && getRecentTarget(session, speakerId)) return 'reaction';
    if (roll < reactionChance + stickerChance) return 'sticker';
    if (roll < reactionChance + stickerChance + emojiChance) return 'emoji';
    return 'text';
}

function relationshipTargetForPrompt(session, speaker, replyTarget) {
    const targetId = replyTarget?.authorId
        || session.recentMessages
            .filter(item => item.authorId !== speaker.client.user.id)
            .slice(-1)[0]?.authorId;
    if (!targetId) return null;
    return session.participants.find(item => item.client.user.id === targetId) || null;
}

function describeScore(value, positiveLabel, neutralLabel, negativeLabel = null) {
    if (value >= 35) return `rất ${positiveLabel}`;
    if (value >= 15) return `khá ${positiveLabel}`;
    if (value <= -18 && negativeLabel) return `khá ${negativeLabel}`;
    return neutralLabel;
}

function relationshipPrompt(session, speaker, replyTarget) {
    const target = relationshipTargetForPrompt(session, speaker, replyTarget);
    if (!target) return '';
    const relationship = getRelationshipContext(
        speaker.client.user.id,
        target.client.user.id
    );
    if (!relationship) {
        return `Bạn và ${target.client.user.username} chưa có nhiều lịch sử chung; phản ứng tự nhiên như hai người mới làm quen.`;
    }

    const memoryLines = relationship.memories
        .slice(-2)
        .map(memory => {
            const author = session.participants.find(
                item => item.client.user.id === memory.fromId
            )?.client?.user?.username || 'một người';
            return `- ${author}: ${cleanText(memory.content, 120)}`;
        });
    return [
        `Quan hệ mô phỏng của bạn với ${target.client.user.username}: ${relationship.label}, đã có khoảng ${relationship.interactions} lượt tương tác.`,
        `Ấn tượng hiện tại: ${describeScore(relationship.affinity, 'quý', 'bình thường', 'khó chịu')}; ${describeScore(relationship.trust, 'tin tưởng', 'chưa quá tin')}; mức căng thẳng ${relationship.tension >= 35 ? 'cao' : relationship.tension >= 15 ? 'hơi có' : 'thấp'}.`,
        relationship.romance >= 15
            ? `Bạn có mức cảm mến đặc biệt ${relationship.romance >= 45 ? 'rõ ràng' : 'mới chớm'}; thể hiện từ từ qua lời nói, không tỏ tình đột ngột.`
            : '',
        relationship.nicknameForOther
            ? `Biệt danh bạn thường dùng cho họ là "${relationship.nicknameForOther}", chỉ dùng đôi lúc khi hợp ngữ cảnh.`
            : '',
        memoryLines.length > 0
            ? `Vài ký ức chung từ các phiên trước:\n${memoryLines.join('\n')}`
            : '',
        'Không đọc tên trạng thái hay các chỉ số này ra chat; chỉ để chúng ảnh hưởng nhẹ đến thái độ.'
    ].filter(Boolean).join('\n');
}

function buildSelfChatPrompt(session, speaker, replyTarget, isExpectedResponse = false, lengthMode = 'short') {
    const contextLimit = readInteger('SELFCHAT_CONTEXT_MESSAGES', 6, 3, 10);
    const transcript = session.recentMessages
        .slice(-contextLimit)
        .map(item => `${item.username}: ${cleanText(stripUrls(stripSelfChatEmojis(item.content)), 180)}`)
        .join('\n');
    const ownMemory = (session.accountMemories.get(speaker.client.user.id) || [])
        .slice(-2)
        .map(content => `- ${content}`)
        .join('\n');
    const previousSessionContext = (session.priorContext || [])
        .slice(-3)
        .map(item => `${item.username}: ${cleanText(item.content, 120)}`)
        .join('\n');
    const instruction = replyTarget
        ? `Hãy phản hồi tự nhiên ý của ${replyTarget.username}: "${cleanText(stripSelfChatEmojis(replyTarget.content), 180)}".`
        : isExpectedResponse
            ? 'Tin gần nhất đang trả lời trực tiếp ý của bạn; hãy đáp lại đúng ý đó, không chuyển chủ đề.'
        : session.recentMessages.length === 0
            ? 'Hãy mở đầu cuộc trò chuyện một cách tự nhiên, không giới thiệu dài dòng.'
            : 'Hãy nói tiếp một ý chung có liên quan, có thể đồng ý, phản biện nhẹ hoặc đặt câu hỏi.';

    const allowSwearing = Math.random() * 100 < readInteger('SELFCHAT_SWEAR_CHANCE_PERCENT', 18, 0, 50);
    const stance = session.stances.get(speaker.client.user.id);
    const sceneInstruction = session.sceneMode === 'tranh luận nhẹ'
        ? `Nhóm đang tranh luận nhẹ. Lập trường của bạn: ${stance || 'trung lập và hay hỏi lại'}. Có thể không đồng ý nhưng không công kích.`
        : `Nhóm hiện đang theo kiểu: ${session.sceneMode}. Chỉ tương tác như một thành viên trong nhóm nhỏ này.`;
    const spotlight = session.participants.find(
        item => item.client.user.id === session.spotlightParticipantId
    );
    const isSpotlight = spotlight?.client?.user?.id === speaker.client.user.id;
    const spotlightInstruction = !spotlight
        ? ''
        : isSpotlight
            ? 'Lượt này bạn đang là tâm điểm của nhóm. Nếu bị trêu thì đáp lại có duyên, tự trêu hoặc phản đòn nhẹ; không cáu và không cố giành mọi lượt.'
            : `${spotlight.client.user.username} đang là tâm điểm của nhánh nói chuyện. Chỉ cà khịa nhẹ nếu đúng mạch; không hội đồng, không xúc phạm ngoại hình, đời tư hay điểm nhạy cảm.`;
    const focusNames = session.participants
        .filter(item =>
            session.focusParticipantIds?.has(item.client.user.id)
            && item.client.user.id !== speaker.client.user.id
        )
        .map(item => item.client.user.username);
    const focusInstruction = session.focusParticipantIds?.has(speaker.client.user.id)
        && focusNames.length > 0
        ? `Bạn đang ở nhánh trao đổi chính với ${focusNames.join(', ')}. Bám ý họ vừa nói và để cuộc đối đáp phát triển tự nhiên, nhưng không nhất thiết dùng Discord reply.`
        : 'Bạn không cần chen vào mọi ý; chỉ góp câu có giá trị hoặc phản ứng đúng lúc.';
    const loopBreakInstruction = (session.loopBreakInstructionUntil || 0) > session.turn
        ? 'Cuộc chat vừa bị lặp ý hoặc bị một cặp độc chiếm. Hãy mở góc hoàn toàn mới, thêm chi tiết cụ thể, kể trải nghiệm, phản biện nhẹ hoặc hỏi người chưa nói; không chỉ xác nhận và diễn đạt lại ý cũ.'
        : '';
    const conversationAngle = session.recentMessages.length >= 2
        ? chooseConversationAngle(session)
        : null;
    const repeatedTerms = getRepeatedSelfChatTerms(session.recentMessages, 3)
        .map(semanticTermLabel);
    const noveltyInstruction = [
        conversationAngle
            ? `Góc phát triển riêng của lượt này: ${conversationAngle}.`
            : '',
        repeatedTerms.length > 0
            ? `Các ý đang bị nhắc quá nhiều: ${repeatedTerms.join(', ')}. Không diễn đạt lại chúng; phải thêm thông tin hoặc hướng mới.`
            : ''
    ].filter(Boolean).join(' ');
    const lengthInstruction = lengthMode === 'long'
        ? 'Lượt này được nói dài hơn: viết 3-6 dòng tự nhiên trong cùng một tin nhắn, mỗi dòng là một ý; khoảng 50-95 từ, không bullet.'
        : lengthMode === 'medium'
            ? 'Lượt này viết 1-2 dòng, khoảng 18-38 từ, vẫn là giọng chat đời thường.'
            : 'Lượt này chỉ viết một câu ngắn khoảng 3-12 từ.';
    return [
        `Chủ đề hiện tại: ${session.topic}.`,
        transcript ? `Các tin gần nhất:\n${transcript}` : '',
        previousSessionContext
            ? `Ký ức mờ từ phiên trước trong kênh này (không phải tin vừa gửi):\n${previousSessionContext}`
            : '',
        ownMemory ? `Trước đó chính bạn đã nói:\n${ownMemory}\nHãy nhất quán, đừng phủ nhận vô cớ.` : '',
        relationshipPrompt(session, speaker, replyTarget),
        sceneInstruction,
        focusInstruction,
        loopBreakInstruction,
        noveltyInstruction,
        spotlightInstruction,
        instruction,
        lengthInstruction,
        `Bạn đang nói bằng tài khoản ${speaker.client.user.username}.`,
        allowSwearing
            ? 'Lượt này có thể dùng đúng một cảm thán tục nhẹ như "vl", "vcl", "đệt", "mé" hoặc "đm" nếu hợp; không chửi thẳng hay xúc phạm ai.'
            : 'Lượt này không cần văng tục.',
        'Chỉ viết nội dung tin nhắn tiếp theo, không ghi tên người nói.'
    ].filter(Boolean).join('\n\n');
}

function buildSelfChatSystem(speaker, lengthMode = 'short') {
    const lengthRule = lengthMode === 'long'
        ? 'Lượt này có thể nói thành một đoạn 3-6 dòng như đang kể hoặc tranh luận; xuống dòng tự nhiên, không dùng danh sách.'
        : lengthMode === 'medium'
            ? 'Lượt này nói vừa phải trong 1-2 dòng, không diễn giải kiểu bài luận.'
            : 'Lượt này ưu tiên 3-12 từ, đúng một câu ngắn.';
    return [
        `Bạn là ${speaker.client.user.username}, một thành viên của nhóm có chung nhân cách "i'm just a bot".`,
        'Bạn là bot thân thiện, bình tĩnh, trực tiếp và không giả vờ là con người.',
        `Kiểu tính cách riêng của tài khoản này: ${speaker.personality?.name || 'Thân thiện'}.`,
        `Đặc điểm cốt lõi: ${speaker.personality?.traits || 'gần gũi và có quan điểm riêng'}.`,
        `Nhịp nói riêng: ${speaker.chatStyle}.`,
        `Nói như chat Discord Việt Nam đời thường. ${lengthRule}`,
        'Thể hiện tính cách qua cách phản ứng chứ không tự giới thiệu vai trò, không nói "với tư cách chuyên gia" và không biến cuộc chat thành buổi tư vấn.',
        'Có thể dùng viết tắt tự nhiên như k, ko, t, m, r, dc; không cần viết đủ chủ-vị hay giảng giải.',
        'Nhịp tham khảo: "sao thế", "ừ cũng đúng", "vl thật à", "chịu luôn", "xàm v", "rồi sao nữa?". Không sao chép máy móc.',
        'Tuyệt đối tránh văn phong triết lý, diễn văn, kết luận đạo lý hoặc câu trả lời kiểu trợ lý AI.',
        'Không lặp lại nguyên văn ý trước. Có quan điểm riêng nhưng không gây gổ.',
        'Không gửi hoặc đề xuất link web, video hay nguồn bên ngoài.',
        'Không tự thêm emoji vào câu trả lời; hệ thống sẽ tự quyết định lúc nào cần emoji.',
        'Không tag tài khoản, không dùng @everyone hoặc @here, không dùng markdown dài.'
    ].join('\n');
}

function waitForSession(session, ms) {
    return new Promise(resolve => {
        if (!session.active) return resolve();
        session.wake = () => {
            if (session.timer) clearTimeout(session.timer);
            session.timer = null;
            session.wake = null;
            resolve();
        };
        session.timer = setTimeout(session.wake, ms);
    });
}

async function showNaturalTyping(session, speaker, content) {
    if (!session.active || typeof speaker.channel?.sendTyping !== 'function') return;
    await speaker.channel.sendTyping().catch(() => {});
    const minTyping = readInteger('SELFCHAT_TYPING_MIN_MS', 700, 0, 5000);
    const maxTyping = readInteger('SELFCHAT_TYPING_MAX_MS', 6500, minTyping, 10000);
    const estimated = cleanText(content, 200).length * 45 + randomBetween(350, 900);
    await waitForSession(session, Math.min(maxTyping, Math.max(minTyping, estimated)));
}

function stopSession(session) {
    session.active = false;
    releaseChannelActivity(session.channelId, 'selfchat');
    session.wake?.();
}

function stopAllSelfChatSessions() {
    let stopped = 0;
    for (const session of sessions.values()) {
        if (!session.active) continue;
        stopSession(session);
        stopped += 1;
    }
    return stopped;
}

async function sendSelfChatMessage(session, speaker, replyTarget, content) {
    const payload = {
        content,
        allowedMentions: { parse: [], repliedUser: false }
    };
    if (replyTarget?.id) {
        payload.reply = {
            messageReference: replyTarget.id,
            failIfNotExists: false
        };
    }

    markGeminiGeneratedAuthor(speaker.client.user.id);
    const sent = await speaker.channel.send(payload);
    markGeminiGeneratedMessage(sent);
    return sent;
}

async function reactToRecentMessage(session, speaker) {
    const target = getRecentTarget(session, speaker.client.user.id);
    if (!target) return false;
    try {
        const targetMessage = await speaker.channel.messages?.fetch?.(target.id);
        if (!targetMessage?.react) return false;
        const emoji = contextualEmoji(target.content, session);
        if (!emoji) return false;
        await targetMessage.react(emoji);
        rememberEmojiUsage(session, emoji);
        return { target, emoji };
    } catch (_) {
        return false;
    }
}

async function sendEmojiMessage(session, speaker) {
    const target = getRecentTarget(session, speaker.client.user.id);
    const content = contextualEmoji(target?.content, session);
    if (!content) return null;
    const sent = await sendSelfChatMessage(session, speaker, null, content);
    rememberEmojiUsage(session, content);
    return { sent, content };
}

async function sendStickerMessage(session, speaker) {
    try {
        let stickers = speaker.channel.guild?.stickers?.cache;
        if (!stickers?.size && speaker.channel.guild?.stickers?.fetch) {
            stickers = await speaker.channel.guild.stickers.fetch();
        }
        const available = [...(stickers?.values?.() || [])]
            .filter(sticker => sticker.available !== false);
        if (available.length === 0) return null;

        const recentText = getRecentTarget(session, speaker.client.user.id)?.content || '';
        const normalized = recentText.toLowerCase();
        let moodWords = [];
        if (/buồn|khóc|chết|mệt|thất tình|xin lỗi/.test(normalized)) moodWords = ['sad', 'cry', 'khoc', 'buon'];
        else if (/haha|hài|vl|vcl|xàm|ngáo/.test(normalized)) moodWords = ['laugh', 'lol', 'haha', 'cuoi'];
        else if (/sao|gì|hả|thật à|ủa/.test(normalized)) moodWords = ['hmm', 'think', 'sus', 'what'];
        else if (/hay|đỉnh|ngon|chuẩn|đúng|xịn|tuyệt/.test(normalized)) moodWords = ['yes', 'ok', 'love', 'fire'];

        const contextual = moodWords.length > 0
            ? available.filter(sticker => {
                const metadata = `${sticker.name || ''} ${sticker.tags || ''}`.toLowerCase();
                return moodWords.some(word => metadata.includes(word));
            })
            : [];
        const sticker = randomItem(contextual.length > 0 ? contextual : available);
        markGeminiGeneratedAuthor(speaker.client.user.id);
        const sent = await speaker.channel.send({
            stickers: [sticker.id],
            allowedMentions: { parse: [], repliedUser: false }
        });
        markGeminiGeneratedMessage(sent);
        return { sent, content: `[sticker ${sticker.name || ''}]`.trim() };
    } catch (_) {
        return null;
    }
}

async function sendMediaMessage(session, speaker, media) {
    if (!media?.absolutePath && !media?.url) return null;
    const captions = media.captions?.length > 0
        ? media.captions
        : MEDIA_CAPTIONS[media.type] || MEDIA_CAPTIONS.image;
    const caption = randomItem(captions);

    try {
        await showNaturalTyping(session, speaker, caption);
        if (!session.active) return null;
        markGeminiGeneratedAuthor(speaker.client.user.id);
        const payload = {
            content: caption,
            allowedMentions: { parse: [], repliedUser: false }
        };
        if (media.url) {
            payload.content = `${caption}\n${media.url}`;
        } else {
            payload.files = [{
                attachment: media.absolutePath,
                name: path.basename(media.absolutePath)
            }];
        }
        const sent = await speaker.channel.send(payload);
        markGeminiGeneratedMessage(sent);
        return {
            sent,
            content: `[${media.type === 'video' ? 'video' : media.type === 'gif' ? 'gif' : 'ảnh'}] ${caption}`
        };
    } catch (error) {
        console.warn(
            `[SELFCHAT] Không gửi được media ${media.relativePath || media.id || 'đã học'}: ${error.message}`
        );
        return null;
    }
}

function recordInteraction(session, speaker, nextExpectedSpeakerId = null) {
    speaker.turns += 1;
    speaker.failures = 0;
    speaker.blockedUntil = 0;
    session.turn += 1;
    session.lastSpeakerId = speaker.client.user.id;
    if (session.expectedSpeakerId === speaker.client.user.id) session.expectedSpeakerId = null;
    if (nextExpectedSpeakerId && nextExpectedSpeakerId !== speaker.client.user.id) {
        session.expectedSpeakerId = nextExpectedSpeakerId;
    }
}

function rememberSentMessage(session, speaker, sent, content, explicitTargetId = null) {
    if (!sent?.id) return;
    const inferredTarget = explicitTargetId
        || session.recentMessages
            .filter(item => item.authorId !== speaker.client.user.id)
            .slice(-1)[0]?.authorId
        || null;
    const target = inferredTarget
        ? session.participants.find(item => item.client.user.id === inferredTarget)
        : null;
    session.recentMessages.push({
        id: sent.id,
        authorId: speaker.client.user.id,
        username: speaker.client.user.username,
        content
    });
    if (session.recentMessages.length > 10) session.recentMessages.shift();

    const memoryText = cleanText(stripUrls(stripSelfChatEmojis(content)), 180);
    if (memoryText && !memoryText.startsWith('[sticker')) {
        const memories = session.accountMemories.get(speaker.client.user.id) || [];
        memories.push(memoryText);
        if (memories.length > 3) memories.shift();
        session.accountMemories.set(speaker.client.user.id, memories);
    }

    recordPersistentConversation({
        channelId: session.channelId,
        speakerId: speaker.client.user.id,
        username: speaker.client.user.username,
        personality: speaker.personality?.name || null,
        content,
        targetId: target?.client?.user?.id || null,
        targetName: target?.client?.user?.username || null,
        topic: session.topic,
        sceneMode: session.sceneMode
    });
}

function fallbackNonDuplicateMessage(session) {
    const candidates = [
        'mà trường hợp ngược lại thì sao?',
        'ví dụ cụ thể đi',
        'ai từng gặp vụ này chưa?',
        'điểm khó nhất là gì?',
        'khoan, đổi góc khác đi',
        'nghe lý thuyết quá, thực tế sao?',
        'có ngoại lệ nào k?',
        'thử nhìn từ phía bên kia xem'
    ];
    return candidates.find(content => !isNearDuplicateSelfChat(content, session.recentMessages))
        || `hmm ${randomBetween(10, 99)}`;
}

export function shouldUseLocalSelfChatReply(session, isExpectedResponse, roll = Math.random()) {
    if (isExpectedResponse || session.recentMessages.length < 2) return false;
    if ((session.loopBreakInstructionUntil || 0) > session.turn) return false;
    const recentMoves = session.recentMessages
        .slice(-2)
        .map(item => classifySelfChatMove(item.content));
    if (recentMoves.every(move => move === 'acknowledgement')) return false;
    const chance = readInteger('SELFCHAT_LOCAL_REPLY_CHANCE_PERCENT', 35, 0, 80);
    return roll * 100 < chance;
}

export function buildLocalSelfChatReply(session, speaker, roll = Math.random()) {
    const latest = String(session.recentMessages.at(-1)?.content || '');
    const personality = String(speaker?.personality?.name || '').toLowerCase();
    let candidates;

    const recentMoves = session.recentMessages
        .slice(-3)
        .map(item => classifySelfChatMove(item.content));
    const acknowledgementLoop = recentMoves.filter(move => move === 'acknowledgement').length >= 2;
    if (acknowledgementLoop || getRepeatedSelfChatTerms(session.recentMessages, 3).length >= 2) {
        candidates = [
            'mà có trường hợp ngược lại k?',
            'ví dụ thực tế đi',
            'ai có góc nhìn khác k?',
            'điểm khó nhất ở đây là gì?',
            'khoan, đổi góc khác xem'
        ];
    } else if (latest.includes('?')) {
        candidates = ['cũng tùy á', 'khó nói thật', 't cũng đang thắc mắc', 'chắc phải thử mới biết', 'm nghĩ sao?'];
    } else if (String(session.sceneMode).includes('tranh luận') || personality.includes('phản biện')) {
        candidates = ['k chắc đâu', 'ý đó chưa thuyết phục lắm', 'cũng có lý nhưng còn tùy', 'thế nếu ngược lại thì sao?', 't thấy hơi cấn'];
    } else if (String(session.sceneMode).includes('cà khịa') || personality.includes('hài')) {
        candidates = ['xàm vừa thôi', 'lại bắt đầu r đó', 'nghe quen vl', 'thánh này nữa', 'chịu m luôn'];
    } else {
        candidates = [
            'ừ cũng đúng',
            'nghe dc đó',
            'kể tiếp đi',
            'rồi sao nữa?',
            'còn góc ngược lại thì sao?',
            'm từng gặp vụ này chưa?',
            'ví dụ cụ thể đi'
        ];
    }

    const usable = candidates.filter(content =>
        !isNearDuplicateSelfChat(content, session.recentMessages)
    );
    const pool = usable.length > 0 ? usable : candidates;
    const index = Math.min(pool.length - 1, Math.floor(Math.max(0, roll) * pool.length));
    return pool[index] || fallbackNonDuplicateMessage(session);
}

async function runSession(session) {
    const minDelay = readInteger('SELFCHAT_DELAY_MIN_MS', 25000, 7000, 120000);
    const maxDelay = readInteger('SELFCHAT_DELAY_MAX_MS', 55000, minDelay, 180000);
    await waitForSession(session, randomBetween(2500, 5000));

    try {
        while (session.active) {
            const maxPairStreak = readInteger('SELFCHAT_MAX_PAIR_STREAK_TURNS', 6, 4, 12);
            const pairStreakDetected = session.participants.length > 2
                && session.turn - (session.lastPairBreakTurn ?? -20) >= maxPairStreak
                && hasLongPairStreak(session.recentMessages, maxPairStreak);
            if (pairStreakDetected) {
                session.expectedSpeakerId = null;
                session.lastPairBreakTurn = session.turn;
                session.lastLoopBreakTurn = session.turn;
                session.loopBreakInstructionUntil = session.turn + 2;
                refreshConversationScene(session);
            }

            const loopDetected = !pairStreakDetected
                && session.turn - (session.lastLoopBreakTurn ?? -20) >= 5
                && detectSelfChatLoop(session.recentMessages);
            if (loopDetected) {
                session.expectedSpeakerId = null;
                session.lastLoopBreakTurn = session.turn;
                session.loopBreakInstructionUntil = session.turn + 3;
                session.recentMessages = session.recentMessages.slice(-2);
                if (session.autoTopic) {
                    let nextTopic;
                    do nextTopic = randomItem(RANDOM_TOPICS);
                    while (nextTopic === session.topic && RANDOM_TOPICS.length > 1);
                    session.topic = nextTopic;
                    session.nextTopicChangeTurn = session.turn + randomBetween(10, 18);
                }
                refreshConversationScene(session);
            }

            if (session.autoTopic && !session.expectedSpeakerId && session.turn >= session.nextTopicChangeTurn) {
                let nextTopic;
                do nextTopic = randomItem(RANDOM_TOPICS);
                while (nextTopic === session.topic && RANDOM_TOPICS.length > 1);
                session.topic = nextTopic;
                session.nextTopicChangeTurn = session.turn + randomBetween(10, 18);
                session.recentMessages = session.recentMessages.slice(-3);
                session.accountMemories = hydrateAccountMemories(session.participants);
                refreshConversationScene(session);
            }

            if (!session.expectedSpeakerId && session.turn >= session.nextSceneTurn) {
                refreshConversationScene(session);
            }

            const speaker = chooseSpeaker(session);
            if (!speaker) break;
            const isExpectedResponse = session.expectedSpeakerId === speaker.client.user.id;
            const currentMediaContext = mediaContext(session);
            const localMedia = selectContextualMedia(
                session.mediaLibrary,
                currentMediaContext,
                session.usedMediaIds
            );
            const learnedGif = getLearnedGifForContext(
                currentMediaContext,
                session.usedLearnedGifIds
            );
            const contextualMedia = learnedGif && (!localMedia || Math.random() < 0.7)
                ? {
                    id: `learned:${learnedGif.id}`,
                    learnedGifId: learnedGif.id,
                    url: learnedGif.url,
                    type: 'gif',
                    captions: MEDIA_CAPTIONS.image,
                    relativePath: `learned:${learnedGif.provider || 'discord'}`
                }
                : localMedia;
            const wantsMedia = shouldSendMedia(
                session,
                speaker,
                isExpectedResponse,
                Boolean(contextualMedia)
            );
            const baseSilentChance = readInteger('SELFCHAT_SILENT_TURN_PERCENT', 10, 0, 35);
            const silenceBonus = personalityNumber(
                speaker,
                'silenceBonus',
                0,
                -10,
                40
            );
            const roleReduction = session.focusParticipantIds?.has(speaker.client.user.id)
                || session.spotlightParticipantId === speaker.client.user.id
                ? 5
                : 0;
            const silentChance = Math.min(
                55,
                Math.max(0, baseSilentChance + silenceBonus - roleReduction)
            );
            const shouldStaySilent = !wantsMedia
                && !isExpectedResponse
                && session.recentMessages.length >= 3
                && Math.random() * 100 < silentChance;
            const interactionType = wantsMedia
                ? 'media'
                : shouldStaySilent
                ? 'silent'
                : isExpectedResponse
                    ? 'text'
                    : chooseInteractionType(session, speaker.client.user.id);

            try {
                let interactionHandled = interactionType === 'silent';
                if (interactionType === 'silent') {
                    session.lastSpeakerId = speaker.client.user.id;
                }

                if (interactionType === 'media') {
                    const mediaResult = await sendMediaMessage(session, speaker, contextualMedia);
                    if (!session.active) break;
                    if (mediaResult) {
                        recordInteraction(session, speaker);
                        rememberSentMessage(
                            session,
                            speaker,
                            mediaResult.sent,
                            mediaResult.content
                        );
                        session.lastMediaTurn = session.turn;
                        session.usedMediaIds.add(contextualMedia.id);
                        if (contextualMedia.learnedGifId) {
                            session.usedLearnedGifIds.add(contextualMedia.learnedGifId);
                            markLearnedGifUsed(contextualMedia.learnedGifId);
                        }
                        interactionHandled = true;
                    }
                }

                if (interactionType === 'reaction') {
                    const reactionResult = await reactToRecentMessage(session, speaker);
                    if (reactionResult) {
                        recordInteraction(session, speaker);
                        const target = session.participants.find(
                            item => item.client.user.id === reactionResult.target.authorId
                        );
                        recordPersistentConversation({
                            channelId: session.channelId,
                            speakerId: speaker.client.user.id,
                            username: speaker.client.user.username,
                            personality: speaker.personality?.name || null,
                            content: `[reaction ${reactionResult.emoji}]`,
                            targetId: target?.client?.user?.id || null,
                            targetName: target?.client?.user?.username || null,
                            topic: session.topic,
                            sceneMode: session.sceneMode
                        });
                        interactionHandled = true;
                    }
                }

                if (!interactionHandled && interactionType === 'sticker') {
                    const stickerResult = await sendStickerMessage(session, speaker);
                    if (stickerResult) {
                        recordInteraction(session, speaker);
                        rememberSentMessage(session, speaker, stickerResult.sent, stickerResult.content);
                        interactionHandled = true;
                    }
                }

                if (!interactionHandled && interactionType === 'emoji') {
                    const emojiResult = await sendEmojiMessage(session, speaker);
                    if (emojiResult) {
                        recordInteraction(session, speaker);
                        rememberSentMessage(session, speaker, emojiResult.sent, emojiResult.content);
                        interactionHandled = true;
                    }
                }

                if (!interactionHandled) {
                    const expectedTarget = isExpectedResponse
                        ? getRecentTarget(session, speaker.client.user.id)
                        : null;
                    const replyTarget = isExpectedResponse
                        ? (Math.random() < 0.3 ? expectedTarget : null)
                        : chooseReplyTarget(session, speaker);
                    const conversationTarget = expectedTarget || replyTarget;
                    const lengthMode = chooseMessageLengthMode(
                        session,
                        isExpectedResponse,
                        Math.random(),
                        speaker
                    );
                    const prompt = buildSelfChatPrompt(
                        session,
                        speaker,
                        conversationTarget,
                        isExpectedResponse,
                        lengthMode
                    );
                    const generationOptions = {
                        maxOutputTokens: lengthMode === 'long' ? 512 : lengthMode === 'medium' ? 384 : 256
                    };
                    const now = Date.now();
                    const quotaCoolingDown = session.geminiCooldownUntil > now;
                    const useLocalReply = quotaCoolingDown
                        || shouldUseLocalSelfChatReply(session, isExpectedResponse);
                    let content;

                    if (useLocalReply) {
                        content = buildLocalSelfChatReply(session, speaker);
                        session.localReplies += 1;
                    } else {
                        try {
                            const generated = await generateGeminiContent(
                                buildSelfChatSystem(speaker, lengthMode),
                                [{
                                    role: 'user',
                                    parts: [{ text: prompt }]
                                }],
                                generationOptions
                            );
                            content = finalizeGeneratedText(generated, session, lengthMode);
                            session.geminiCalls += 1;
                        } catch (error) {
                            if (!error?.quotaLimited && error?.code !== 'GEMINI_KEYS_COOLDOWN') throw error;
                            session.geminiCooldownUntil = Date.now() + Math.max(
                                60000,
                                Number(error.retryAfterMs) || 60000
                            );
                            session.quotaFallbacks += 1;
                            session.localReplies += 1;
                            content = buildLocalSelfChatReply(session, speaker);
                            if (Date.now() - session.lastQuotaLogAt > 60000) {
                                const minutes = Math.max(
                                    1,
                                    Math.ceil((session.geminiCooldownUntil - Date.now()) / 60000)
                                );
                                console.warn(
                                    `[SELFCHAT] Các nhà cung cấp AI cooldown khoảng ${minutes} phút; tạm dùng câu trả lời cục bộ.`
                                );
                                session.lastQuotaLogAt = Date.now();
                            }
                        }
                    }
                    if (!session.active) break;

                    const brokeStagnation = isStagnantSelfChatReply(
                        content,
                        session.recentMessages
                    );
                    if (brokeStagnation) {
                        content = fallbackNonDuplicateMessage(session);
                        session.expectedSpeakerId = null;
                        session.loopBreakInstructionUntil = Math.max(
                            session.loopBreakInstructionUntil || 0,
                            session.turn + 2
                        );
                    }
                    if (!content) throw new Error('Gemini trả về nội dung rỗng.');
                    await showNaturalTyping(session, speaker, content);
                    if (!session.active) break;
                    const sent = await sendSelfChatMessage(session, speaker, replyTarget, content);

                    recordInteraction(
                        session,
                        speaker,
                        nextExpectedSpeakerAfterTurn(
                            isExpectedResponse || brokeStagnation,
                            replyTarget
                        )
                    );
                    rememberSentMessage(
                        session,
                        speaker,
                        sent,
                        content,
                        conversationTarget?.authorId || null
                    );
                    if (lengthMode === 'long') session.lastLongTurn = session.turn;
                }
            } catch (error) {
                speaker.failures += 1;
                speaker.blockedUntil = Date.now() + Math.min(
                    10 * 60 * 1000,
                    30000 * (2 ** Math.min(4, speaker.failures - 1))
                );
                console.error(`[SELFCHAT] ${speaker.client.user.username}: ${error.message}`);
                await waitForSession(session, Math.min(60000, 10000 * speaker.failures));
            }

            if (!session.active) break;
            let delay = randomBetween(minDelay, maxDelay);
            if (session.turn > 0 && session.turn % randomBetween(8, 14) === 0) {
                delay += randomBetween(15000, 35000);
            }
            await waitForSession(session, delay);
        }
    } finally {
        if (sessions.get(session.channelId) === session) sessions.delete(session.channelId);
        releaseChannelActivity(session.channelId, 'selfchat');
    }
}

async function sendCommandNotice(message, content) {
    try {
        return await message.channel.send({
            content,
            allowedMentions: { parse: [], repliedUser: false }
        });
    } catch (_) {
        return null;
    }
}

export async function handleSelfChatCommand(message, clients) {
    observeGifForSelfChat(message, clients);
    const command = parseSelfChatCommand(message?.content);
    if (!command || !message?.id || !message?.channel?.id) return false;
    if (!isManagedAuthor(message, clients)) return false;
    if (!rememberCommand(message.id)) return true;

    const channelId = message.channel.id;
    const existing = sessions.get(channelId);

    if (command.type === 'offall') {
        setGeminiEnabled(false);
        const stoppedSessions = stopAllSelfChatSessions();
        await sendCommandNotice(
            message,
            `⛔ Đã tắt Gemini chat trên toàn bộ ${clients.length} tài khoản và dừng ${stoppedSessions} phiên selfchat.`
        );
        return true;
    }

    if (command.type === 'status') {
        if (!existing?.active) {
            await sendCommandNotice(message, 'Selfchat chưa chạy trong kênh này.');
            return true;
        }
        const now = Date.now();
        const activeNames = existing.participants
            .filter(item => existing.activeParticipantIds.has(item.client.user.id))
            .map(item => item.client.user.username);
        const coolingNames = existing.participants
            .filter(item => (item.blockedUntil || 0) > now)
            .map(item => item.client.user.username);
        await sendCommandNotice(
            message,
            [
                `📊 Selfchat: ${existing.participants.length} tài khoản truy cập được kênh.`,
                `Nhóm đang nói (${activeNames.length}): ${activeNames.join(', ') || '-'}.`,
                `Đang cooldown (${coolingNames.length}): ${coolingNames.join(', ') || '-'}.`,
                `Cảnh: ${existing.sceneMode}; lượt ${existing.turn}, đổi nhóm sau tối đa ${Math.max(0, existing.nextSceneTurn - existing.turn)} lượt.`
            ].join('\n')
        );
        return true;
    }

    if (command.type === 'quota') {
        const keys = getGeminiKeyStatus();
        const groqKeys = getGroqKeyStatus();
        const retryText = keys.nextRetryMs > 0
            ? ` Key gần nhất thử lại sau khoảng ${Math.max(1, Math.ceil(keys.nextRetryMs / 60000))} phút.`
            : '';
        const groqRetryText = groqKeys.nextRetryMs > 0
            ? ` Groq thử lại sau khoảng ${Math.max(1, Math.ceil(groqKeys.nextRetryMs / 60000))} phút.`
            : '';
        const sessionText = existing
            ? ` Phiên này: ${existing.geminiCalls} lượt AI, ${existing.localReplies} lượt cục bộ, ${existing.quotaFallbacks} lần chuyển do quota.`
            : '';
        await sendCommandNotice(
            message,
            `🔑 Gemini: ${keys.available}/${keys.configured} sẵn sàng, ${keys.coolingDown} cooldown. Groq: ${groqKeys.available}/${groqKeys.configured} sẵn sàng, ${groqKeys.coolingDown} cooldown.${retryText}${groqRetryText}${sessionText}`
        );
        return true;
    }

    if (command.type === 'memory') {
        const stats = getSelfChatMemoryStats();
        await sendCommandNotice(
            message,
            `🧠 Bộ nhớ selfchat: ${stats.accounts} tài khoản, ${stats.relationships} mối quan hệ, ${stats.channels} kênh và ${stats.gifs} GIF đã học.`
        );
        return true;
    }

    if (command.type === 'end') {
        if (!existing) {
            await sendCommandNotice(message, 'Selfchat chưa chạy trong kênh này.');
            return true;
        }
        stopSession(existing);
        await sendCommandNotice(message, '✅ Selfchat đã dừng.');
        return true;
    }

    if (existing?.active) {
        if (command.topic) {
            existing.topic = command.topic;
            existing.autoTopic = false;
            existing.recentMessages = existing.recentMessages.slice(-3);
            existing.accountMemories = hydrateAccountMemories(existing.participants);
            refreshConversationScene(existing);
            await sendCommandNotice(message, `Đã đổi chủ đề selfchat: ${command.topic}`);
        } else {
            await sendCommandNotice(message, `Selfchat đang chạy về: ${existing.topic}`);
        }
        return true;
    }

    const channelActivity = getChannelActivity(channelId);
    if (channelActivity && channelActivity.mode !== 'selfchat') {
        await sendCommandNotice(
            message,
            `Không thể bật selfchat vì kênh này đang chạy ${channelActivity.mode}. Hãy dừng chế độ đó trước.`
        );
        return true;
    }

    const participants = await findParticipants(clients, channelId);
    if (participants.length < 2) {
        await sendCommandNotice(message, 'Cần ít nhất 2 tài khoản có quyền xem và gửi tin trong kênh này để chạy selfchat.');
        return true;
    }

    const autoTopic = !command.topic;
    const session = {
        channelId,
        active: true,
        autoTopic,
        topic: command.topic || randomItem(RANDOM_TOPICS),
        participants,
        recentMessages: [],
        recentConversationAngles: [],
        priorContext: getPersistentChannelContext(channelId, 6),
        recentEmojis: [],
        accountMemories: hydrateAccountMemories(participants),
        lastSpeakerId: null,
        expectedSpeakerId: null,
        turn: 0,
        nextTopicChangeTurn: randomBetween(10, 18),
        nextSceneTurn: 0,
        sceneGeneration: 0,
        activeParticipantIds: new Set(),
        focusParticipantIds: new Set(),
        spotlightParticipantId: null,
        sceneMode: 'đối đáp thân mật',
        stances: new Map(),
        lastLongTurn: -20,
        mediaLibrary: loadSelfChatMediaLibrary(),
        usedMediaIds: new Set(),
        usedLearnedGifIds: new Set(),
        lastMediaTurn: -100,
        geminiCalls: 0,
        localReplies: 0,
        quotaFallbacks: 0,
        geminiCooldownUntil: 0,
        lastQuotaLogAt: 0,
        lastLoopBreakTurn: -20,
        lastPairBreakTurn: -20,
        loopBreakInstructionUntil: 0,
        timer: null,
        wake: null
    };
    refreshConversationScene(session);
    if (!claimChannelActivity(channelId, 'selfchat')) {
        await sendCommandNotice(message, 'Kênh vừa được một chế độ hội thoại khác sử dụng. Hãy thử lại sau.');
        return true;
    }
    sessions.set(channelId, session);

    const openingFocus = participants
        .filter(item => session.focusParticipantIds.has(item.client.user.id))
        .map(item => `${item.client.user.username} (${item.personality?.name || 'Thân thiện'})`)
        .join(', ');
    const memoryStats = getSelfChatMemoryStats();
    await sendCommandNotice(
        message,
        `💬 Selfchat đã kết nối ${participants.length} tài khoản, nhóm mở đầu có ${session.activeParticipantIds.size} người${autoTopic ? ' với chủ đề ngẫu nhiên' : ` bàn về: ${session.topic}`}. Nhánh chính: ${openingFocus}.${session.mediaLibrary.length > 0 ? ` Kho media: ${session.mediaLibrary.length} tệp.` : ''}${memoryStats.gifs > 0 ? ` Đã học ${memoryStats.gifs} GIF.` : ''} Gõ !selfchatend để dừng.`
    );
    runSession(session).catch(error => {
        console.error(`[SELFCHAT] Phiên ${channelId} dừng do lỗi: ${error.message}`);
        stopSession(session);
    });
    return true;
}

export function getSelfChatStatus(channelId) {
    const session = sessions.get(String(channelId));
    if (!session) return null;
    return {
        active: session.active,
        topic: session.topic,
        participants: session.participants.length,
        activeParticipants: session.activeParticipantIds.size,
        sceneMode: session.sceneMode,
        spotlightParticipantId: session.spotlightParticipantId,
        memory: getSelfChatMemoryStats(),
        geminiCalls: session.geminiCalls,
        localReplies: session.localReplies,
        quotaFallbacks: session.quotaFallbacks,
        geminiCoolingDown: session.geminiCooldownUntil > Date.now(),
        turn: session.turn
    };
}
