const activities = new Map();

export function getChannelActivity(channelId) {
    return activities.get(String(channelId)) || null;
}

export function claimChannelActivity(channelId, mode) {
    const key = String(channelId);
    const current = activities.get(key);
    if (current && current.mode !== mode) return false;
    activities.set(key, {
        mode,
        startedAt: current?.startedAt || Date.now()
    });
    return true;
}

export function releaseChannelActivity(channelId, mode) {
    const key = String(channelId);
    const current = activities.get(key);
    if (!current || (mode && current.mode !== mode)) return false;
    activities.delete(key);
    return true;
}
