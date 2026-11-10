# Gemini mention/reply chat

Tính năng này cho mỗi tài khoản một nhân cách và bộ nhớ hội thoại riêng. Tài khoản chỉ phản hồi khi bị mention trực tiếp hoặc khi người dùng reply một tin nhắn do chính tài khoản đó gửi. Tin nhắn từ các tài khoản đang được chương trình quản lý sẽ bị bỏ qua để tránh vòng lặp tự nói chuyện vô hạn.

## Cấu hình

1. Nếu key từng bị chia sẻ hoặc commit, thu hồi rồi tạo key mới.
2. Sao chép `.env.example` thành `.env.local` nếu chưa có file cấu hình riêng. Cả `.env` và `.env.local` đều được loại khỏi Git; `.env.local` ghi đè các giá trị trùng trong `.env`.
3. Điền key của dịch vụ đang dùng vào `.env.local`; để trống provider không sử dụng. Ví dụ dưới đây chỉ chứa placeholder, phải thay trước khi chạy:

```dotenv
GEMINI_API_KEYS=key_moi_1,key_moi_2,key_moi_3
GEMINI_MODEL=gemini-3.6-flash
GEMINI_MENTION_ENABLED=true
GROQ_API_KEYS=gsk_key_du_phong
GROQ_MODEL=qwen/qwen3.6-27b
TOKENROUTER_API_KEYS=key_tokenrouter_cua_ban
TOKENROUTER_MODEL=qwen/qwen3.8-max-free
```

Các ID model trên là mặc định trong mã, không bảo đảm provider còn cung cấp hoặc mọi key đều truy cập được. Nếu gặp lỗi model, chọn ID khả dụng của provider tương ứng rồi khởi động lại. Xem [hướng dẫn cài đặt và cấu hình tài khoản](README.md#cài-đặt-và-chạy).

Hệ thống tách key bằng dấu phẩy và bỏ khoảng trắng hai đầu, tự luân phiên key sau mỗi phản hồi. Khi gặp `429`, key đó được đưa vào cooldown theo `Retry-After`/`RetryInfo` của Google hoặc backoff tăng dần; mỗi yêu cầu mặc định chỉ thử tối đa 3 key Gemini để tránh quét sạch quota trong vài giây.

Lưu ý: Gemini tính giới hạn theo Google Cloud project, không tính riêng cho từng API key. Vì vậy nhiều key cùng một project vẫn dùng chung RPM/TPM/RPD. Xoay key giúp bỏ qua key lỗi hoặc key thuộc project khác, nhưng không làm tăng quota của cùng một project. Xem [quota Gemini](https://ai.google.dev/gemini-api/docs/rate-limits).

Thứ tự gọi dịch vụ là `Gemini → Groq → TokenRouter`. Tầng dự phòng chỉ được gọi nếu đã cấu hình key và tầng trước không trả được kết quả. Key của mỗi provider có vòng xoay và cooldown riêng. Khi tất cả provider đều lỗi, selfchat dùng câu đáp cục bộ; luồng mention/reply gửi thông báo lỗi kết nối. Nhiều key thuộc cùng một Groq organization vẫn dùng chung [giới hạn của organization](https://console.groq.com/docs/rate-limits).

Nội dung hội thoại dùng làm ngữ cảnh được gửi tới provider đang xử lý lượt đó, bao gồm các provider dự phòng đã cấu hình. `node scripts/checkGemini.mjs` có thể kiểm tra Gemini bằng API thật và tiêu thụ quota; không kiểm tra Groq/TokenRouter.

## Nhân cách từng tài khoản

Các tài khoản vẫn thuộc nhóm chung `i'm just a bot`, nhưng được gán lần lượt 29 kiểu tính cách trong `gemini-personalities.json` theo thứ tự đăng nhập. Vì thứ tự token không đổi nên vai của mỗi tài khoản cũng ổn định sau khi khởi động lại. Có thể khóa một vai cho tài khoản cụ thể bằng ID hoặc username trong `accounts`:

```json
{
  "accounts": {
    "123456789012345678": "Hài hước",
    "ten_tai_khoan": "Lạnh lùng"
  }
}
```

Mỗi hồ sơ có mức độ nói, tỷ lệ im lặng, xu hướng reply, độ dài câu và khả năng trở thành tâm điểm khác nhau. Hài hước, Gen Z, Kể chuyện và Người tranh luận thường hoạt động mạnh; Tối giản, Lạnh lùng và Lịch thiệp ít chen vào hơn.

## Điều khiển

- `;talkbot status`: xem trạng thái, model và số key đã nạp.
- `;talkbot on`: bật trả lời tự động.
- `;talkbot off`: tắt trả lời tự động.
- `;talkbot clear`: xóa bộ nhớ hội thoại đang nằm trong RAM.

## Selfchat giữa các tài khoản

- `!selfchat`: bắt đầu trò chuyện với chủ đề ngẫu nhiên; chủ đề tự đổi sau một số lượt.
- `!selfchat <nội dung>`: bắt đầu bàn luận theo nội dung đã nhập.
- Khi đang chạy, `!selfchat <nội dung mới>` sẽ đổi chủ đề mà không kết thúc phiên.
- `!selfchatend`: dừng ngay phiên trong kênh hiện tại.
- `!offall`: tắt Gemini mention/reply trên toàn bộ tài khoản và dừng tất cả phiên selfchat đang chạy.
- `!selfchatmemory`: xem số tài khoản, quan hệ, kênh và GIF đã được ghi nhớ.
- `!selfchatquota`: xem số key sẵn sàng/cooldown và số lượt Gemini/cục bộ của phiên.
- `!selfchatstatus`: xem tổng số tài khoản truy cập được kênh, nhóm đang nói và tài khoản đang cooldown.

Các tài khoản không còn bị ép luân phiên tuyệt đối, nhưng vẫn không dùng cùng một tài khoản hai lượt liên tiếp. Tài khoản hoạt ngôn có trọng số xuất hiện cao hơn, còn tài khoản ít nói có thể bỏ qua lượt. Nếu A reply tin của B, hệ thống vẫn bắt buộc B nói ở lượt kế tiếp, tránh tài khoản C chen ngang sai mạch. Reply Discord chỉ xuất hiện theo xu hướng riêng của từng vai; các lượt khác là tin chung, reaction, emoji hoặc sticker của server. Emoji do Gemini tự sinh bị loại bỏ; hệ thống chỉ thêm lại với xác suất thấp và không lặp cùng emoji trong 8 lần dùng gần nhất. Mỗi tương tác cách nhau 25-55 giây và đôi lúc nghỉ lâu hơn. Chỉ 6 tin gần nhất được đưa vào Gemini để hạn chế token.

Để cuộc trò chuyện bớt máy móc, mỗi tài khoản có một nhịp nói ổn định được suy ra từ ID nhưng vẫn giữ chung nhân cách `i'm just a bot`. Mỗi tài khoản nhớ tối đa 3 câu gần nhất chính mình đã nói để tránh tự mâu thuẫn. Hệ thống hiển thị trạng thái đang gõ theo độ dài câu, có khoảng 10% lượt im lặng. Mặc định 35% lượt văn bản thông thường dùng câu đáp cục bộ không gọi Gemini; reaction, sticker, emoji và GIF cũng không tốn quota Gemini. Câu bị lặp được thay cục bộ thay vì gọi Gemini lần thứ hai. Nếu Gemini trả `429`, selfchat tiếp tục bằng câu cục bộ trong lúc các key cooldown nên phiên không bị đứng.

Mỗi giai đoạn chỉ có một nhóm ngẫu nhiên 2-5 tài khoản hoạt động mạnh; nhóm được xoay sau 6-10 lượt. Trong nhóm có một cặp hoặc bộ ba làm nhánh trao đổi chính. Ở cảnh cà khịa vui hoặc một số cảnh ngẫu nhiên, một tài khoản được chọn làm tâm điểm: người đó có thể tự trêu hoặc phản đòn, còn các tài khoản khác chỉ được cà khịa nhẹ và không công kích đời tư, ngoại hình hay điểm nhạy cảm. Khoảng 22% tin có độ dài vừa; xác suất tin dài 3-6 dòng được điều chỉnh theo tính cách và có cooldown ít nhất 8 lượt.

Lớp chống loop giới hạn một cặp nói liên tục tối đa 6 lượt, kết thúc reply bắt buộc sau một lần đáp và bắt buộc đưa thành viên mới vào khi đổi cảnh. Các cách diễn đạt tương đương như `kế hoạch/plan/phương án` hoặc `track/theo dõi/review tiến độ` được xem là cùng một ý. Nếu nhiều lượt liên tiếp chỉ xác nhận hoặc diễn đạt lại, hệ thống hủy nhánh cũ và chuyển sang ví dụ, ngoại lệ, phản biện, trải nghiệm hoặc câu hỏi mới mà không gọi thêm AI.

Selfchat không còn tạo hoặc gửi link web, video hay nguồn bên ngoài.

### Ảnh và video không dùng Gemini

Selfchat có thể gửi ảnh, GIF hoặc video local mà không gọi Gemini. Chỉ các tệp trong thư mục `selfchat-media` mới được dùng; thư mục `images` và các vị trí khác không bao giờ bị quét. Bot so từ khóa trong chủ đề và 6 tin gần nhất với tag trong tên tệp hoặc `selfchat-media.json`, nên media sai chủ đề sẽ không được gửi.

Mặc định một lượt đủ điều kiện có xác suất khoảng 3% và hai media cách nhau ít nhất 28 lượt. Media không chen vào lượt reply bắt buộc. Mỗi tệp tối đa 8 MB theo cấu hình an toàn mặc định. Xem hướng dẫn đặt tên và tag tại `selfchat-media/README.md`.

### Tự học GIF

Mỗi tin nhắn ngoài nhóm tài khoản được quản lý sẽ được kiểm tra một lần. Nếu đó là GIF từ Discord CDN, Tenor hoặc GIPHY, bot ghi nhớ URL cùng các từ khóa lấy từ tối đa 6 câu chat ngay trước GIF. Bot không gọi Gemini cho bước học hoặc chọn GIF. URL từ host khác bị từ chối để tránh dùng nguồn không an toàn.

Kho GIF được lưu trong `selfchat-memory.json`, tối đa 300 mục. GIF đã dùng được đánh dấu để hạn chế lặp. Khi chủ đề hiện tại khớp từ khóa đã học, GIF tham gia chung xác suất và cooldown media; nếu không khớp thì bot tiếp tục chat hoặc dùng sticker như bình thường.

### Ký ức và quan hệ qua nhiều phiên

`selfchat-memory.json` còn lưu tối đa 20 câu gần nhất của mỗi tài khoản, 30 câu mỗi kênh, 12 ký ức ngắn mỗi cặp và tối đa 1.000 mối quan hệ. Tệp được ghi theo hàng đợi, dùng tệp tạm và tự thử lại khi Windows khóa file.

Mỗi quan hệ có góc nhìn riêng theo hai chiều: thiện cảm, tin cậy, căng thẳng, mức cảm mến và biệt danh. Các giá trị chỉ thay đổi một lượng nhỏ sau tương tác trực tiếp. Cà khịa trong cảnh vui gây ảnh hưởng nhẹ hơn tranh cãi thật. Chỉ một số cặp có độ hợp cao mới phát triển cảm mến; cần ít nhất 20 tương tác và thiện cảm từ cả hai phía. Các mức như bạn bè, bạn thân, khắc khẩu, có cảm tình hoặc gắn bó như người yêu chỉ là trạng thái nhân vật mô phỏng.

Khi bắt đầu phiên mới, bot lấy một phần ký ức cũ để giữ mạch nhưng ghi rõ đó không phải tin vừa gửi. Cặp có lịch sử mạnh có thể được chọn làm nhánh đối đáp chính. Biệt danh được tạo dần khi đủ thân, căng thẳng hoặc cảm mến và chỉ được dùng đôi lúc.

Muốn đặt lại toàn bộ ký ức, dừng chương trình rồi xóa `selfchat-memory.json`. Thao tác này không ảnh hưởng token hay cấu hình tài khoản.

## Lưu ý

- Lịch sử AI mention/reply chỉ tồn tại trong RAM, mất khi khởi động lại hoặc dùng `;talkbot clear`. Ký ức selfchat lưu trong `selfchat-memory.json` và tồn tại qua lần khởi động lại.
- Nội dung AI gửi ra không được phép ping `@everyone`, `@here` hoặc tự tag người khác.
- Các lệnh `!selfchat...` dùng dấu `!` cố định và chỉ nhận từ tài khoản đang được quản lý. `!offall` dừng selfchat và tắt mention/reply, không dừng debate/debatevoz.
- Discord không cho phép selfbot trên tài khoản người dùng và có thể khóa tài khoản; xem [thông báo chính thức](https://support.discord.com/hc/en-us/articles/115002192352-Automated-User-Accounts-Self-Bots). Repo này không chạy bằng bot token của ứng dụng bot chính thức.
