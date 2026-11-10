const rosters = new Map();

export function registerDebateRoster(channelId, mode, userIds, onStop) {
    const key = String(channelId);
    if (rosters.has(key)) throw new Error('Kênh đã có danh sách debate đang hoạt động.');
    const members = new Set(userIds.map(String));
    let closed = false;
    const roster = {
        mode,
        has: userId => !closed && members.has(String(userId)),
        exclude(userId) {
            if (!roster.has(userId)) return { status: 'not-participant', mode };
            members.delete(String(userId));
            const remaining = members.size;
            const stopped = remaining < 2;
            if (stopped) {
                roster.close();
                onStop();
            }
            return { status: 'removed', mode, remaining, stopped };
        },
        close() {
            closed = true;
            if (rosters.get(key) === roster) rosters.delete(key);
        }
    };
    rosters.set(key, roster);
    return roster;
}

export function excludeDebateAccount(channelId, userId) {
    return rosters.get(String(channelId))?.exclude(userId) || { status: 'inactive' };
}

// Check again at every send, including upload fallbacks and chunks after an await.
export function guardDebateChannel(channel, roster, userId) {
    return {
        send(payload) {
            if (!roster?.has(userId)) {
                const error = new Error('Tài khoản đã rời phiên debate.');
                error.code = 'DEBATE_ACCOUNT_EXCLUDED';
                throw error;
            }
            return channel.send(payload);
        }
    };
}
