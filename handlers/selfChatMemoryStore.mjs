import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MEMORY_FILE = process.env.SELFCHAT_MEMORY_FILE
    ? path.resolve(process.env.SELFCHAT_MEMORY_FILE)
    : path.join(__dirname, '../selfchat-memory.json');
const WRITE_DEBOUNCE_MS = 500;
const MAX_RELATIONSHIPS = 1000;
const MAX_CHANNELS = 100;
const MAX_GIFS = 300;

const POSITIVE_WORDS = [
    'đúng', 'hay', 'đỉnh', 'ngon', 'thích', 'cảm ơn', 'cam on', 'chuẩn',
    'vui', 'cười', 'cuốn', 'xịn', 'tốt', 'hợp lý', 'hợp lí', 'cute', 'dễ thương'
];
const NEGATIVE_WORDS = [
    'ghét', 'bực', 'cáu', 'sai rồi', 'xàm', 'dở', 'chán', 'khó chịu',
    'im đi', 'thôi đi', 'vô lý', 'vô lí', 'ngu'
];
const AFFECTION_WORDS = [
    'thương', 'yêu', 'nhớ', 'thích', 'crush', 'cưng', 'bé', 'quan tâm', 'dễ thương', 'cute'
];
const JOKE_WORDS = ['haha', 'hihi', 'kkk', 'lol', 'đùa', 'giỡn', 'cà khịa', 'meme'];
const TAG_STOP_WORDS = new Set([
    'la', 'va', 'cua', 'cho', 'voi', 'mot', 'nhung', 'nay', 'kia', 'thi',
    'ma', 'co', 'khong', 'duoc', 'roi', 'sao', 'the', 'gi', 'qua', 'cai',
    'con', 'minh', 'ban', 'tao', 'may', 'toi', 'no', 'do', 'day', 'dang',
    'noi', 'chuyen', 'that', 'luon', 'cung', 'rat', 'hon', 'khi', 'neu',
    'just', 'bot', 'https', 'http', 'com'
]);

let store = loadStore();
let writeTimer = null;
let writeQueue = Promise.resolve();
let dirty = false;
let lastWriteErrorAt = 0;

function emptyStore() {
    return {
        version: 1,
        accounts: {},
        channels: {},
        relationships: {},
        gifs: []
    };
}

function loadStore() {
    try {
        if (!fs.existsSync(MEMORY_FILE)) return emptyStore();
        const parsed = JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8'));
        return {
            version: 1,
            accounts: parsed?.accounts && typeof parsed.accounts === 'object'
                ? parsed.accounts
                : {},
            channels: parsed?.channels && typeof parsed.channels === 'object'
                ? parsed.channels
                : {},
            relationships: parsed?.relationships && typeof parsed.relationships === 'object'
                ? parsed.relationships
                : {},
            gifs: Array.isArray(parsed?.gifs) ? parsed.gifs : []
        };
    } catch (error) {
        console.error(`[SELFCHAT MEMORY] Không đọc được bộ nhớ cũ: ${error.message}`);
        return emptyStore();
    }
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, Number(value) || 0));
}

function normalizeText(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .replace(/đ/gi, 'd')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizeToneText(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function countTerms(text, terms) {
    const padded = ` ${normalizeToneText(text)} `;
    return terms.reduce(
        (score, term) =>
            score + (padded.includes(` ${normalizeToneText(term)} `) ? 1 : 0),
        0
    );
}

export function analyzeInteractionTone(content) {
    return {
        positive: countTerms(content, POSITIVE_WORDS),
        negative: countTerms(content, NEGATIVE_WORDS),
        affection: countTerms(content, AFFECTION_WORDS),
        joking: countTerms(content, JOKE_WORDS)
    };
}

function hashText(value) {
    let hash = 0;
    for (const char of String(value || '')) {
        hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
    }
    return Math.abs(hash);
}

function pairKey(firstId, secondId) {
    return [String(firstId), String(secondId)].sort().join('|');
}

function defaultView() {
    return {
        affinity: 0,
        trust: 0,
        tension: 0,
        romance: 0,
        nicknameForOther: null,
        nicknameTone: null
    };
}

function ensurePair(data, firstId, secondId) {
    const key = pairKey(firstId, secondId);
    const ids = [String(firstId), String(secondId)].sort();
    if (!data.relationships[key]) {
        data.relationships[key] = {
            ids,
            interactions: 0,
            chemistry: hashText(key) % 100,
            views: {
                [ids[0]]: defaultView(),
                [ids[1]]: defaultView()
            },
            memories: [],
            updatedAt: new Date().toISOString()
        };
    }
    const pair = data.relationships[key];
    pair.views ||= {};
    pair.views[ids[0]] ||= defaultView();
    pair.views[ids[1]] ||= defaultView();
    pair.memories = Array.isArray(pair.memories) ? pair.memories : [];
    return pair;
}

function shortName(value) {
    const cleaned = String(value || 'bot').replace(/[^\p{L}\p{N}_\s.-]/gu, '').trim();
    return cleaned.split(/\s+/)[0].slice(0, 18) || 'bot';
}

function nicknameFor(view, otherName, seed) {
    let tone = null;
    let templates = [];
    if (view.romance >= 35) {
        tone = 'romantic';
        templates = ['bé {name}', '{name} ơi', 'cục nợ {name}'];
    } else if (view.affinity >= 32) {
        tone = 'friendly';
        templates = ['{name}', 'ông {name}', '{name} bro'];
    } else if (view.tension >= 35 || view.affinity <= -22) {
        tone = 'rival';
        templates = ['ngài {name}', 'thánh {name}', '{name} khó ở'];
    }
    if (!tone) return { text: null, tone: null };
    if (view.nicknameForOther && view.nicknameTone === tone) {
        return { text: view.nicknameForOther, tone };
    }
    const template = templates[hashText(seed) % templates.length];
    return {
        text: template.replace('{name}', shortName(otherName)),
        tone
    };
}

export function relationshipLabel(pair) {
    if (!pair) return 'chưa quen';
    const views = pair.ids.map(id => pair.views[id] || defaultView());
    const average = key => views.reduce((sum, view) => sum + (view[key] || 0), 0) / views.length;
    const affinity = average('affinity');
    const tension = average('tension');
    const romance = average('romance');

    if (romance >= 70 && affinity >= 42) return 'gắn bó như người yêu';
    if (romance >= 40 && affinity >= 30) return 'có cảm tình đặc biệt';
    if (affinity >= 45 && pair.interactions >= 30) return 'bạn thân';
    if (affinity >= 20 && pair.interactions >= 12) return 'bạn bè';
    if (affinity <= -25 && tension >= 30) return 'khắc khẩu';
    if (tension >= 28) return 'đang căng thẳng';
    if (pair.interactions >= 8) return 'quen biết';
    return 'mới làm quen';
}

export function evolveRelationship(data, event) {
    const fromId = String(event.fromId || '');
    const toId = String(event.toId || '');
    if (!fromId || !toId || fromId === toId) return null;

    const pair = ensurePair(data, fromId, toId);
    pair.interactions += 1;
    pair.updatedAt = event.at || new Date().toISOString();
    const tone = analyzeInteractionTone(event.content);
    const playfulScene = /cà khịa|hai huoc|hài hước|đối đáp thân mật/i
        .test(normalizeText(event.sceneMode));
    const receiverView = pair.views[toId];
    const speakerView = pair.views[fromId];
    const softenedNegative = playfulScene && receiverView.affinity >= 12
        ? tone.negative * 0.3
        : tone.negative;

    receiverView.affinity = clamp(
        receiverView.affinity + 0.18 + tone.positive * 1.15 + tone.affection * 1.2
            - softenedNegative * 1.4,
        -100,
        100
    );
    receiverView.trust = clamp(
        receiverView.trust + 0.12 + tone.positive * 0.3 - softenedNegative * 0.55,
        -100,
        100
    );
    receiverView.tension = clamp(
        receiverView.tension + softenedNegative * 1.3
            - tone.positive * 0.35 - tone.joking * 0.15,
        0,
        100
    );

    speakerView.affinity = clamp(
        speakerView.affinity + 0.1 + tone.positive * 0.45 + tone.affection * 0.8
            - tone.negative * 0.4,
        -100,
        100
    );
    speakerView.trust = clamp(
        speakerView.trust + 0.08 + tone.positive * 0.15 - tone.negative * 0.2,
        -100,
        100
    );
    speakerView.tension = clamp(
        speakerView.tension + tone.negative * 0.35 - tone.positive * 0.12,
        0,
        100
    );

    const romanceEligible = pair.chemistry >= 65
        && pair.interactions >= 20
        && speakerView.affinity >= 22
        && receiverView.affinity >= 22;
    if (romanceEligible) {
        const romanticStep = 0.08 + tone.affection * 1.2 + tone.positive * 0.08;
        speakerView.romance = clamp(
            speakerView.romance + romanticStep - tone.negative * 1.2,
            0,
            100
        );
        receiverView.romance = clamp(
            receiverView.romance + romanticStep * 0.75 - softenedNegative * 1.5,
            0,
            100
        );
    } else if (tone.negative > 0) {
        speakerView.romance = clamp(speakerView.romance - tone.negative, 0, 100);
        receiverView.romance = clamp(receiverView.romance - softenedNegative, 0, 100);
    }

    const fromName = event.fromName || data.accounts[fromId]?.username || fromId;
    const toName = event.toName || data.accounts[toId]?.username || toId;
    const fromNickname = nicknameFor(speakerView, toName, `${fromId}:${toId}`);
    const toNickname = nicknameFor(receiverView, fromName, `${toId}:${fromId}`);
    speakerView.nicknameForOther = fromNickname.text;
    speakerView.nicknameTone = fromNickname.tone;
    receiverView.nicknameForOther = toNickname.text;
    receiverView.nicknameTone = toNickname.tone;

    pair.memories.push({
        at: pair.updatedAt,
        fromId,
        toId,
        content: String(event.content || '').replace(/\s+/g, ' ').trim().slice(0, 180),
        topic: String(event.topic || '').replace(/\s+/g, ' ').trim().slice(0, 100),
        tone
    });
    if (pair.memories.length > 12) pair.memories.shift();
    return pair;
}

export function extractContextTags(value, limit = 12) {
    const counts = new Map();
    const words = normalizeText(value)
        .replace(/https?:\/\/\S+/g, ' ')
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .split(/\s+/)
        .filter(word => word.length >= 3 && !TAG_STOP_WORDS.has(word));
    for (const word of words) counts.set(word, (counts.get(word) || 0) + 1);
    return [...counts.entries()]
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .slice(0, limit)
        .map(([word]) => word);
}

export function selectLearnedGif(gifs, context, usedIds = new Set(), roll = Math.random()) {
    if (!Array.isArray(gifs) || gifs.length === 0) return null;
    const contextTags = new Set(extractContextTags(context, 24));
    const unused = gifs.filter(gif => !usedIds.has(gif.id));
    const pool = unused.length > 0 ? unused : gifs;
    const scored = pool.map(gif => {
        const matches = (gif.tags || []).filter(tag => contextTags.has(normalizeText(tag))).length;
        return { gif, score: matches };
    });
    const maxScore = Math.max(...scored.map(item => item.score));
    const candidates = maxScore > 0
        ? scored.filter(item => item.score === maxScore).map(item => item.gif)
        : pool.filter(gif => (gif.tags || []).some(tag => ['meme', 'reaction'].includes(tag)));
    if (candidates.length === 0) return null;
    return candidates[Math.min(candidates.length - 1, Math.floor(roll * candidates.length))];
}

function pruneStore() {
    for (const account of Object.values(store.accounts)) {
        account.recentMessages = Array.isArray(account.recentMessages)
            ? account.recentMessages.slice(-20)
            : [];
    }
    const channelEntries = Object.entries(store.channels)
        .sort((left, right) =>
            String(right[1]?.updatedAt || '').localeCompare(String(left[1]?.updatedAt || ''))
        );
    store.channels = Object.fromEntries(channelEntries.slice(0, MAX_CHANNELS));
    for (const channel of Object.values(store.channels)) {
        channel.recentMessages = Array.isArray(channel.recentMessages)
            ? channel.recentMessages.slice(-30)
            : [];
        channel.topics = Array.isArray(channel.topics) ? channel.topics.slice(-10) : [];
    }
    const relationshipEntries = Object.entries(store.relationships)
        .sort((left, right) =>
            String(right[1]?.updatedAt || '').localeCompare(String(left[1]?.updatedAt || ''))
        );
    store.relationships = Object.fromEntries(relationshipEntries.slice(0, MAX_RELATIONSHIPS));
    store.gifs = store.gifs
        .sort((left, right) =>
            String(right.lastUsedAt || right.learnedAt || '')
                .localeCompare(String(left.lastUsedAt || left.learnedAt || ''))
        )
        .slice(0, MAX_GIFS);
}

async function writeWithRetry(snapshot) {
    const temporaryFile = `${MEMORY_FILE}.tmp`;
    await fs.promises.mkdir(path.dirname(MEMORY_FILE), { recursive: true });
    let lastError;
    for (let attempt = 0; attempt < 5; attempt++) {
        try {
            await fs.promises.writeFile(temporaryFile, snapshot, 'utf8');
            await fs.promises.rename(temporaryFile, MEMORY_FILE);
            return;
        } catch (error) {
            lastError = error;
            if (!['UNKNOWN', 'EBUSY', 'EPERM', 'EACCES'].includes(error?.code)) break;
            await new Promise(resolve => setTimeout(resolve, 100 * (2 ** attempt)));
        }
    }
    throw lastError;
}

function queueWrite() {
    if (!dirty) return writeQueue;
    dirty = false;
    pruneStore();
    const snapshot = JSON.stringify(store, null, 2);
    writeQueue = writeQueue
        .catch(() => {})
        .then(() => writeWithRetry(snapshot))
        .catch(error => {
            dirty = true;
            if (Date.now() - lastWriteErrorAt >= 30_000) {
                lastWriteErrorAt = Date.now();
                console.error(`[SELFCHAT MEMORY] Không lưu được bộ nhớ: ${error.message}`);
            }
            scheduleWrite(1500);
        });
    return writeQueue;
}

function scheduleWrite(delay = WRITE_DEBOUNCE_MS) {
    dirty = true;
    if (writeTimer) return;
    writeTimer = setTimeout(() => {
        writeTimer = null;
        void queueWrite();
    }, delay);
    writeTimer.unref?.();
}

export async function flushSelfChatMemory() {
    if (writeTimer) {
        clearTimeout(writeTimer);
        writeTimer = null;
    }
    await queueWrite();
}

export function recordPersistentConversation(event) {
    const speakerId = String(event.speakerId || '');
    const channelId = String(event.channelId || '');
    if (!speakerId || !channelId) return;
    const now = event.at || new Date().toISOString();
    const content = String(event.content || '').replace(/\s+/g, ' ').trim().slice(0, 300);
    if (!content) return;

    store.accounts[speakerId] ||= {
        username: event.username || speakerId,
        personality: event.personality || null,
        recentMessages: []
    };
    const account = store.accounts[speakerId];
    account.username = event.username || account.username;
    account.personality = event.personality || account.personality;
    account.recentMessages ||= [];
    account.recentMessages.push({
        at: now,
        channelId,
        content,
        targetId: event.targetId || null,
        topic: String(event.topic || '').slice(0, 100)
    });
    if (account.recentMessages.length > 20) account.recentMessages.shift();

    store.channels[channelId] ||= { recentMessages: [], topics: [], updatedAt: now };
    const channel = store.channels[channelId];
    channel.updatedAt = now;
    channel.recentMessages ||= [];
    channel.recentMessages.push({
        at: now,
        speakerId,
        username: event.username || account.username,
        content,
        targetId: event.targetId || null
    });
    if (channel.recentMessages.length > 30) channel.recentMessages.shift();
    const topic = String(event.topic || '').trim().slice(0, 100);
    if (topic && channel.topics?.at?.(-1) !== topic) {
        channel.topics ||= [];
        channel.topics.push(topic);
        if (channel.topics.length > 10) channel.topics.shift();
    }

    if (event.targetId && String(event.targetId) !== speakerId) {
        const targetId = String(event.targetId);
        store.accounts[targetId] ||= {
            username: event.targetName || targetId,
            personality: null,
            recentMessages: []
        };
        evolveRelationship(store, {
            fromId: speakerId,
            toId: targetId,
            fromName: event.username,
            toName: event.targetName,
            content,
            topic,
            sceneMode: event.sceneMode,
            at: now
        });
    }
    scheduleWrite();
}

export function getPersistentAccountMemories(accountId, limit = 3) {
    return (store.accounts[String(accountId)]?.recentMessages || [])
        .slice(-limit)
        .map(item => item.content);
}

export function getPersistentChannelContext(channelId, limit = 6) {
    return (store.channels[String(channelId)]?.recentMessages || []).slice(-limit);
}

export function getRelationshipContext(fromId, toId) {
    const pair = store.relationships[pairKey(fromId, toId)];
    if (!pair) return null;
    const view = pair.views?.[String(fromId)] || defaultView();
    return {
        label: relationshipLabel(pair),
        interactions: pair.interactions || 0,
        affinity: view.affinity || 0,
        trust: view.trust || 0,
        tension: view.tension || 0,
        romance: view.romance || 0,
        nicknameForOther: view.nicknameForOther || null,
        memories: (pair.memories || []).slice(-4)
    };
}

export function findStrongestRelationshipPair(participantIds) {
    const ids = new Set(participantIds.map(String));
    let strongest = null;
    for (const pair of Object.values(store.relationships)) {
        if (!pair?.ids?.every(id => ids.has(String(id)))) continue;
        const views = pair.ids.map(id => pair.views?.[id] || defaultView());
        const average = key => views.reduce((sum, view) => sum + (view[key] || 0), 0) / 2;
        const score = (pair.interactions || 0) * 0.25
            + Math.abs(average('affinity'))
            + average('tension')
            + average('romance') * 1.3;
        if (!strongest || score > strongest.score) {
            strongest = {
                ids: [...pair.ids],
                score,
                label: relationshipLabel(pair)
            };
        }
    }
    return strongest?.score >= 8 ? strongest : null;
}

export function learnGifMemory(gif) {
    const url = String(gif.url || '').trim();
    if (!url) return null;
    const id = String(gif.id || hashText(url));
    const existing = store.gifs.find(item => item.id === id || item.url === url);
    const tags = [...new Set([
        ...(existing?.tags || []),
        ...(gif.tags || []).map(normalizeText).filter(Boolean)
    ])].slice(0, 16);
    if (existing) {
        existing.tags = tags;
        existing.context = gif.context || existing.context;
        scheduleWrite();
        return existing;
    }
    const entry = {
        id,
        url,
        provider: gif.provider || 'discord',
        tags: tags.length > 0 ? tags : ['reaction', 'meme'],
        context: String(gif.context || '').replace(/\s+/g, ' ').trim().slice(0, 300),
        learnedAt: new Date().toISOString(),
        lastUsedAt: null,
        uses: 0
    };
    store.gifs.push(entry);
    pruneStore();
    scheduleWrite();
    return entry;
}

export function getLearnedGifForContext(context, usedIds = new Set(), roll = Math.random()) {
    return selectLearnedGif(store.gifs, context, usedIds, roll);
}

export function markLearnedGifUsed(id) {
    const gif = store.gifs.find(item => item.id === String(id));
    if (!gif) return;
    gif.uses = (gif.uses || 0) + 1;
    gif.lastUsedAt = new Date().toISOString();
    scheduleWrite();
}

export function getSelfChatMemoryStats() {
    return {
        accounts: Object.keys(store.accounts).length,
        relationships: Object.keys(store.relationships).length,
        channels: Object.keys(store.channels).length,
        gifs: store.gifs.length
    };
}
