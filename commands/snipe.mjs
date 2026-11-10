import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import moment from 'moment';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DELETED_MESSAGES_FILE = process.env.DELETED_MESSAGES_FILE
    ? path.resolve(process.env.DELETED_MESSAGES_FILE)
    : path.join(__dirname, '../deleted_messages.json');
const MAX_MESSAGES_PER_CHANNEL = 10;
const MAX_STORED_CHANNELS = Math.max(
    50,
    Number.parseInt(process.env.SNIPE_MAX_STORED_CHANNELS || '500', 10) || 500
);
const WRITE_DEBOUNCE_MS = 350;
const DUPLICATE_TTL_MS = 10 * 60 * 1000;

let needsStartupCompaction = false;
let deletedMessages = loadDeletedMessages();
let writeTimer = null;
let writeQueue = Promise.resolve();
let dirty = false;
let lastWriteErrorAt = 0;
const recentlyStoredMessageIds = new Map();

function loadDeletedMessages() {
    try {
        if (!fs.existsSync(DELETED_MESSAGES_FILE)) return {};
        const parsed = JSON.parse(fs.readFileSync(DELETED_MESSAGES_FILE, 'utf8'));
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
        needsStartupCompaction = pruneStoredChannels(parsed);
        return parsed;
    } catch (error) {
        console.error('Không thể đọc deleted_messages.json, bắt đầu bộ nhớ snipe mới:', error.message);
        return {};
    }
}

function pruneStoredChannels(store) {
    const channelIds = Object.keys(store);
    let changed = false;

    for (const channelId of channelIds) {
        if (!Array.isArray(store[channelId])) {
            delete store[channelId];
            changed = true;
            continue;
        }
        if (store[channelId].length > MAX_MESSAGES_PER_CHANNEL) {
            store[channelId] = store[channelId].slice(0, MAX_MESSAGES_PER_CHANNEL);
            changed = true;
        }
    }

    const remainingIds = Object.keys(store);
    if (remainingIds.length <= MAX_STORED_CHANNELS) return changed;

    remainingIds
        .sort((left, right) => {
            const leftTime = String(store[left]?.[0]?.timestamp || '');
            const rightTime = String(store[right]?.[0]?.timestamp || '');
            return rightTime.localeCompare(leftTime);
        })
        .slice(MAX_STORED_CHANNELS)
        .forEach(channelId => {
            delete store[channelId];
            changed = true;
        });

    return changed;
}

function rememberMessageId(messageId) {
    if (!messageId) return;
    const now = Date.now();
    recentlyStoredMessageIds.set(String(messageId), now + DUPLICATE_TTL_MS);
    if (recentlyStoredMessageIds.size < 2000) return;

    for (const [id, expiresAt] of recentlyStoredMessageIds) {
        if (expiresAt <= now) recentlyStoredMessageIds.delete(id);
    }
}

function wasRecentlyStored(messageId) {
    if (!messageId) return false;
    const id = String(messageId);
    const expiresAt = recentlyStoredMessageIds.get(id) || 0;
    if (expiresAt <= Date.now()) {
        recentlyStoredMessageIds.delete(id);
        return false;
    }
    return true;
}

function isRetryableFileError(error) {
    return ['UNKNOWN', 'EBUSY', 'EPERM', 'EACCES', 'EMFILE', 'ENFILE']
        .includes(String(error?.code || '').toUpperCase());
}

function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function writeSnapshotWithRetry(snapshot) {
    const temporaryFile = `${DELETED_MESSAGES_FILE}.tmp`;
    await fs.promises.mkdir(path.dirname(DELETED_MESSAGES_FILE), { recursive: true });

    let lastError;
    for (let attempt = 0; attempt < 5; attempt++) {
        try {
            await fs.promises.writeFile(temporaryFile, snapshot, 'utf8');
            await fs.promises.rename(temporaryFile, DELETED_MESSAGES_FILE);
            return;
        } catch (error) {
            lastError = error;
            if (!isRetryableFileError(error) || attempt === 4) break;
            await wait(100 * (2 ** attempt));
        }
    }
    throw lastError;
}

function reportWriteError(error) {
    const now = Date.now();
    if (now - lastWriteErrorAt < 30_000) return;
    lastWriteErrorAt = now;
    console.error(
        'Không thể lưu deleted_messages.json sau nhiều lần thử; bot vẫn tiếp tục chạy:',
        error.message
    );
}

function queueWrite() {
    if (!dirty) return writeQueue;
    dirty = false;
    const snapshot = JSON.stringify(deletedMessages, null, 2);

    writeQueue = writeQueue
        .catch(() => {})
        .then(() => writeSnapshotWithRetry(snapshot))
        .catch(error => {
            dirty = true;
            reportWriteError(error);
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

export async function flushDeletedMessages() {
    if (writeTimer) {
        clearTimeout(writeTimer);
        writeTimer = null;
    }
    await queueWrite();
}

export function addDeletedMessage(message) {
    try {
        const channelId = String(message?.channel?.id || '');
        const messageId = String(message?.id || '');
        if (!channelId || wasRecentlyStored(messageId)) return false;

        const channelMessages = deletedMessages[channelId] || [];
        if (messageId && channelMessages.some(item => String(item.id || '') === messageId)) {
            rememberMessageId(messageId);
            return false;
        }

        const attachments = Array.from(message?.attachments?.values?.() || [])
            .map(attachment => attachment?.url)
            .filter(Boolean);
        const messageData = {
            id: messageId || undefined,
            content: message?.content || 'No content',
            author: message?.author?.tag || message?.author?.username || 'Unknown',
            authorId: message?.author?.id || null,
            timestamp: moment().format('YYYY-MM-DD HH:mm:ss'),
            attachments
        };

        deletedMessages[channelId] = [messageData, ...channelMessages]
            .slice(0, MAX_MESSAGES_PER_CHANNEL);
        rememberMessageId(messageId);
        pruneStoredChannels(deletedMessages);
        scheduleWrite();
        return true;
    } catch (error) {
        console.error('Lỗi khi lưu tin nhắn đã xóa:', error.message);
        return false;
    }
}

export function clearDeletedMessages(channelId) {
    const id = String(channelId || '');
    if (!id || !deletedMessages[id]) return false;
    delete deletedMessages[id];
    scheduleWrite();
    return true;
}

function getDeletedMessages(channelId) {
    return deletedMessages[String(channelId || '')] || [];
}

if (!fs.existsSync(DELETED_MESSAGES_FILE) || needsStartupCompaction) {
    scheduleWrite();
}

export const name = 'snipe';
export const permission = 'everyone';

export async function execute(message) {
    try {
        const messages = getDeletedMessages(message.channel.id);

        if (messages.length === 0) {
            const reply = await message.channel.send(
                'Không tìm thấy tin nhắn nào đã xóa trong kênh này.'
            );
            setTimeout(() => {
                message.delete().catch(() => {});
                reply.delete().catch(() => {});
            }, 2000);
            return;
        }

        let response = '**Tin nhắn đã xóa gần đây:**\n';
        messages.forEach((msg, index) => {
            response += `\n**${index + 1}.** ${msg.author} - ${msg.timestamp}\n`;
            response += `> ${msg.content}`;
            if (msg.attachments?.length > 0) {
                response += `\n> ${msg.attachments.join('\n> ')}`;
            }
        });

        const reply = await message.channel.send(response.slice(0, 1950));
        setTimeout(() => {
            message.delete().catch(() => {});
            reply.delete().catch(() => {});
        }, 30000);
    } catch (error) {
        console.error('Lỗi khi thực thi lệnh snipe:', error);
        const reply = await message.channel.send('Đã xảy ra lỗi khi xử lý lệnh.');
        setTimeout(() => {
            message.delete().catch(() => {});
            reply.delete().catch(() => {});
        }, 5000);
    }
}
