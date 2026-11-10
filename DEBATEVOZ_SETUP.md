# Debate VOZ

`debatevoz` relay tuần tự các thread công khai trong mục **Chuyện trò linh tinh™ (f17)**. Một thread được đọc từ trang đầu đến trang cuối trước khi bot chuyển sang thread kế tiếp.

## Lệnh

- `;debatevoz`: chạy liên tục.
- `;debatevoz once`: lấy trọn một thread rồi dừng.
- `;debatevoz status`: xem thread, trang và bài chat hiện tại.
- `;debatevoz skip`: ghi nhớ thread hiện tại là đã bỏ qua và chuyển sang thread kế tiếp.
- `;debatevoz stop`: dừng an toàn, giữ đúng trang và vị trí bài chat để lần sau tiếp tục.
- `;debatevoz help`: xem nhanh các lệnh.

Bot cần ít nhất hai tài khoản truy cập được kênh. Mỗi tên tác giả VOZ được gán ổn định cho một tài khoản Discord trong phiên; tác giả mới được phân bổ theo số lượt để các tài khoản vẫn nói tương đối cân bằng. Quote nội bộ VOZ được ánh xạ thành Discord reply khi tin gốc đã được relay trong phiên hiện tại. Các tài khoản còn lại có thể reaction bằng emoji Unicode hoặc emoji của server.

## Nội dung và media

- Văn bản dài được chia thành nhiều tin nhưng không cắt mất nội dung.
- Nếu server có emoji trùng hoặc gần tên smilie VOZ, bot dùng emoji server ngay trong nội dung, ví dụ `:shame:` có thể dùng `:shame_x2:`. Emoji bị khóa hoặc tài khoản không có role phù hợp sẽ bị bỏ qua. Nếu không tìm thấy emoji server, bot đổi sang Unicode (`:amazed:` → `😲`, `:big_smile:` → `😄`). Shortcode hoàn toàn không nhận diện được sẽ bị xóa để Discord không hiện chuỗi `:ten_emoji:` thô.
- Một tỷ lệ nhỏ tin không có smilie nguồn sẽ được thêm một emoji server phù hợp với sắc thái. Tỷ lệ này chỉnh bằng `DEBATEVOZ_INLINE_EMOJI_CHANCE_PERCENT` (mặc định 22%).
- Ảnh, GIF và video trực tiếp được tải rồi đính kèm Discord.
- Link media luôn được gửi kèm, nên vẫn còn nội dung dự phòng nếu file quá lớn, host chặn tải hoặc Discord giới hạn upload.
- Video nhúng như YouTube được giữ dưới dạng link để Discord tự tạo preview.
- Request VOZ có retry và khoảng nghỉ để tránh gọi dồn dập. Nếu Cloudflare chặn riêng trang danh mục, bot tự chuyển sang RSS công khai của VOZ để lấy danh sách thread. Nếu trang nội dung tạm bị chặn, bot giữ nguyên phiên và tiến độ rồi thử lại, không tự thoát.

## Chống trùng và tiếp tục sau restart

Tiến độ nằm trong `usedVozThreads.json`:

- `usedThreadIds`: các thread đã đọc hết hoặc đã `skip`.
- `active`: thread, trang và chỉ số bài chat tiếp theo chưa gửi.

Tệp được cập nhật sau mỗi bài chat. Vì vậy khi bot dừng hoặc khởi động lại, `;debatevoz` tiếp tục từ vị trí đã lưu thay vì lấy lại từ đầu. Tệp này đã được đưa vào `.gitignore` vì là dữ liệu chạy thực tế.

## Tùy chỉnh

Các giá trị mặc định nằm trong `.env.example`. Những biến thường dùng nhất:

- `DEBATEVOZ_POST_DELAY_MS`: khoảng nghỉ giữa hai bài chat, mặc định 8 giây.
- `DEBATEVOZ_CATALOG_PAGES`: số trang danh mục quét trong mỗi lượt. Bot luôn kiểm tra trang mới nhất, đồng thời lưu con trỏ để đi dần về các trang cũ thay vì chỉ quét một vùng cố định.
- `DEBATEVOZ_MAX_MEDIA_PER_POST`: số media tối đa tải trong một bài chat.
- `DEBATEVOZ_MEDIA_MAX_BYTES`: dung lượng tối đa của mỗi media.
- `DEBATEVOZ_REACTION_CHANCE_PERCENT`: xác suất thêm reaction.

Không nên đặt delay request hoặc delay bài chat quá thấp vì VOZ và Discord đều có giới hạn truy cập.
