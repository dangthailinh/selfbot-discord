export const name = 'phantich';
export const permission = 'everyone';

export async function execute(message) {
  try {
    const guild = message.guild;  // Lấy thông tin server (guild)
    const categories = guild.channels.cache.filter(channel => channel.type === 'GUILD_CATEGORY');  // Lọc các danh mục
    const textChannels = guild.channels.cache.filter(channel => channel.type === 'GUILD_TEXT');  // Lọc các kênh text
    const voiceChannels = guild.channels.cache.filter(channel => channel.type === 'GUILD_VOICE');  // Lọc các kênh voice

    // Tổng số danh mục, kênh text, kênh voice
    const totalCategories = categories.size;
    const totalTextChannels = textChannels.size;
    const totalVoiceChannels = voiceChannels.size;

    let categoryList = totalCategories > 0 ? categories.map(category => `>>> 🗂️ ${category.name}`).join('\n') : '>>> ❌ Không có danh mục nào.';
    let textChannelList = totalTextChannels > 0 ? textChannels.map(channel => {
      const canSendMessages = channel.permissionsFor(message.guild.me).has('SEND_MESSAGES') ? '✅ message' : '❌ message';
      const canSendImages = channel.permissionsFor(message.guild.me).has('ATTACH_FILES') ? '✅ image' : '❌ image';
      const canSendSlowMode = channel.rateLimitPerUser > 0 ? `✅ slow` : `❌ slow`;
      return `>>> 📝 ${channel.name} - ${canSendMessages}, ${canSendSlowMode}, ${canSendImages}`;
    }).join('\n') : '>>> ❌ Không có kênh text nào.';
    let voiceChannelList = totalVoiceChannels > 0 ? voiceChannels.map(channel => {
      const canJoinVoice = channel.permissionsFor(message.guild.me).has('CONNECT') ? '✅ join' : '❌ join';
      const canSendMessages = channel.permissionsFor(message.guild.me).has('SEND_MESSAGES') ? '✅ message' : '❌ message';
      const canSendImages = channel.permissionsFor(message.guild.me).has('ATTACH_FILES') ? '✅ image' : '❌ image';
      return `>>> 🔊 ${channel.name} - ${canJoinVoice}, ${canSendMessages}, ${canSendImages}`;
    }).join('\n') : '>>> ❌ Không có kênh voice nào.';

    // Phân tích quyền của bot trong server (tóm tắt)
    const permissions = guild.me.permissions;

    const adminPermissions = permissions.has('ADMINISTRATOR') ? '✅ Quản trị viên' : '❌ Không phải quản trị viên';
    const manageServer = permissions.has('MANAGE_GUILD') ? '✅ Quản lý server' : '❌ Không thể quản lý server';
    const manageChannels = permissions.has('MANAGE_CHANNELS') ? '✅ Quản lý kênh' : '❌ Không thể quản lý kênh';
    const sendMessages = permissions.has('SEND_MESSAGES') ? '✅ Gửi tin nhắn' : '❌ Không thể gửi tin nhắn';
    const manageMessages = permissions.has('MANAGE_MESSAGES') ? '✅ Quản lý tin nhắn' : '❌ Không thể quản lý tin nhắn';
    const joinVoice = permissions.has('CONNECT') ? '✅ Tham gia kênh voice' : '❌ Không thể tham gia kênh voice';
    const attachFiles = permissions.has('ATTACH_FILES') ? '✅ Đính kèm tệp' : '❌ Không thể đính kèm tệp';


    const permissionsList = `
>>> ${adminPermissions} | ${manageServer} | ${manageChannels} | ${sendMessages} | ${manageMessages} | ${joinVoice} | ${attachFiles}
    `;

    // Gửi kết quả phân tích server và quyền của bot
    const analysisMessage = `
>>> **Tổng cộng:**
>>> 🗂️ Danh mục: ${totalCategories}
>>> 📝 Kênh chat: ${totalTextChannels}
>>> 🔊 Kênh voice: ${totalVoiceChannels}

>>> **Bot đang thấy các danh mục:**
${categoryList}

>>> **Text Channel:**
${textChannelList}

>>> **Voice Channel:**
${voiceChannelList}

>>> **Quyền của bot:**
${permissionsList}
    `;

    const sentMessage = await message.channel.send(analysisMessage);

    // Xóa tin nhắn sau 15 giây
    setTimeout(() => {
      sentMessage.delete().catch(err => console.error('Không thể xóa tin nhắn:', err));
    }, 15000);  // 15 giây (15 * 1000ms)
  } catch (err) {
    console.error('Lỗi khi phân tích server:', err);
    await message.channel.send('>>> ❌ Đã xảy ra lỗi khi phân tích server.');
  }
}
