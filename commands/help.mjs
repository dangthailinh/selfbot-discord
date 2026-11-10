import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, '../config.json');

function getPrefix() {
  if (existsSync(CONFIG_PATH)) {
    try {
      const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
      return config.prefix || ';';
    } catch (err) {
      console.error('Lỗi khi đọc prefix từ config:', err);
      return ';';
    }
  }
  return ';';
}

export const name = 'help';
export const permission = 'everyone';

export async function execute(message, args, client) {  // Sửa: Thêm args, client để khớp handler
  const prefix = client?.prefix || getPrefix();  // Sửa nhẹ: Dùng client nếu có, fallback getPrefix()
  const VALID_TYPES = ['PLAYING', 'STREAMING', 'LISTENING', 'WATCHING', 'CUSTOM', 'COMPETING'];

  const helpMessage = `>>> 🔧 **MILKITA SELFBOT** 🔧
Prefix hiện tại: \`${prefix}\`
━━━━━━━━━━━━━━━
💤 **AFK & TỰ ĐỘNG CHAT**
• \`${prefix}afk\` - Bật/tắt chế độ AFK
• \`${prefix}autochat <giây> <số lần> <nội dung>\` - Lặp lại tin nhắn
• \`${prefix}typing <delay> <nội dung>\` - Giả lập đang gõ

🗂️ **THẢO LUẬN FORUM**
• \`${prefix}debate [board|general|adult|random]\` - Chạy debate 4chan trong kênh hiện tại
• \`${prefix}debate status\` - Xem trạng thái debate
• \`${prefix}debate stop\` - Dừng riêng debate
• \`${prefix}debatecpt\` - Loại tài khoản gửi lệnh khỏi debate/debatevoz hiện tại; dưới 2 tài khoản thì dừng
• \`${prefix}debateforum [board|general|random] [số topic]\` - Tạo từng topic forum từ thread 4chan
• \`${prefix}debateforum status\` - Xem tiến trình
• \`${prefix}debateforum stop\` - Dừng sau thao tác hiện tại
• \`${prefix}debatevoz\` - Lấy tuần tự toàn bộ thread VOZ Chuyện trò linh tinh
• \`${prefix}debatevoz status|skip|stop\` - Xem, bỏ qua bài hoặc dừng và lưu tiến độ

👤 **THÔNG TIN NGƯỜI DÙNG**
• \`${prefix}avatar <tag/id>\` - Xem avatar
• \`${prefix}banner <tag/id>\` - Xem banner

🔊 **VOICE & SYSTEM**
• \`${prefix}join <tag/id/link>\` - Treo room voice
• \`${prefix}uptime\` - Xem thời gian hoạt động
• \`${prefix}ping\` - Xem ping
• \`${prefix}prefix <ký tự>\` - Đổi prefix

🧹 **TIN NHẮN**
• \`${prefix}purge <số lượng>\` - Xóa tin nhắn
• \`${prefix}say <nội dung>\` - Gửi tin nhắn
• \`${prefix}snipe\` - Xem tin nhắn đã xóa
• \`${prefix}spam <số lượng> <delay> <nội dung>\` - Spam
• \`${prefix}spamallchannel <số lượng> <delay> <nội dung>\` - Spam toàn server

📒 **NOTE**
• \`${prefix}note <nội dung>\` - Lưu ghi chú
• \`${prefix}note list\` - Xem danh sách
• \`${prefix}note delete <id>\` - Xóa ghi chú

🏦 **QR BANKING**
• \`${prefix}qr id <ngân hàng>\` - Tìm ID ngân hàng
• \`${prefix}qr edit <id> <số TK> <chủ TK>\` - Thêm thông tin
• \`${prefix}qr bank <số tiền> <nội dung>\` - Tạo mã QR
• \`${prefix}qr clear\` - Xóa ngân hàng

📊 **THÔNG TIN SERVER**
• \`${prefix}serverinfo\` - Xem thông tin
• \`${prefix}phantich\` - Phân tích quyền

💻 **TRẠNG THÁI DISCORD**
• \`${prefix}status on/off\` - Bật/tắt trạng thái
📌 Tùy chỉnh status:
• \`app_name\`: Tên ứng dụng
• \`type\`: Loại hoạt động (${VALID_TYPES.join(', ')})
• \`large_image\`, \`small_image\`: Ảnh
• \`details\`: Ghi chú
• \`timestamp\`: \`true\`, \`false\`, hoặc số giây

📝 Ví dụ:
\`${prefix}status edit app_name My Game\`
\`${prefix}status edit type PLAYING\`
\`${prefix}status edit details "Đang chơi game"\`
━━━━━━━━━━━━━━━`;

  const reply = await message.channel.send(helpMessage);
  setTimeout(() => {
    message.delete().catch(() => {});
    reply.delete().catch(() => {});
  }, 60000);
}
