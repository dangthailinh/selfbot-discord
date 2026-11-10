// Count accounts in the target channel, not all tokens loaded by the process.
export async function findRoleplayParticipants(clients, channelId) {
    const participants = [];
    const seen = new Set();
    for (const client of clients) {
        const userId = client?.user?.id;
        if (!userId || seen.has(userId) || client.isReady?.() === false) continue;
        try {
            const channel = client.channels?.cache?.get(channelId)
                || await client.channels?.fetch?.(channelId);
            if (typeof channel?.send !== 'function') continue;
            if (typeof channel.permissionsFor === 'function') {
                const sendPermission = channel.isThread?.()
                    ? 'SEND_MESSAGES_IN_THREADS'
                    : 'SEND_MESSAGES';
                if (!channel.permissionsFor(client.user)?.has(['VIEW_CHANNEL', sendPermission])) continue;
            }
            if (channel.sendable === false) continue;
            seen.add(userId);
            participants.push({ client, channel });
        } catch (_) {
            // An account outside this server/channel must not block the others.
        }
    }
    return participants;
}
