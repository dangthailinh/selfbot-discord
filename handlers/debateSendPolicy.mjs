export function isGuildFileUploadLimitedError(error) {
    const message = String(error?.message || error || '').toLowerCase();
    return message.includes('access to file uploads has been limited for this guild')
        || message.includes('file uploads have been limited for this guild');
}

export async function sendWithUploadFallback(channel, sendOptions) {
    try {
        return {
            message: await channel.send(sendOptions),
            uploadLimited: false,
            mediaSkipped: false
        };
    } catch (error) {
        const hasFiles = Array.isArray(sendOptions?.files) && sendOptions.files.length > 0;
        if (!hasFiles || !isGuildFileUploadLimitedError(error)) throw error;

        const textOnlyOptions = { ...sendOptions };
        delete textOnlyOptions.files;
        if (!String(textOnlyOptions.content || '').trim()) {
            return {
                message: null,
                uploadLimited: true,
                mediaSkipped: true,
                originalError: error
            };
        }

        return {
            message: await channel.send(textOnlyOptions),
            uploadLimited: true,
            mediaSkipped: false,
            originalError: error
        };
    }
}
