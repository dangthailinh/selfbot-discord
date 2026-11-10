# Kho media cho selfchat

Đặt ảnh hoặc video vào thư mục này. Bot chỉ đọc các định dạng:

- Ảnh: `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`
- Video: `.mp4`, `.webm`, `.mov`

Tên file được dùng như tag tự động. Ví dụ:

- `game-meme-thua-rank.gif`
- `phim-anime-buon.webp`
- `do-an-pho-ngon.jpg`
- `du-lich-bien-vui.mp4`

Khi chủ đề hoặc các tin gần đây chứa một tag tương ứng, tệp mới đủ điều
kiện được gửi. Dùng `meme`, `random`, `reaction` hoặc `chung` trong tên file
nếu muốn tệp có thể xuất hiện ở nhiều chủ đề.

Muốn đặt tag và câu dẫn chính xác hơn, thêm mục tương ứng vào
`selfchat-media.json` ở thư mục gốc:

```json
{
  "items": [
    {
      "file": "game/game-meme-thua-rank.gif",
      "tags": ["game", "thua rank", "đồng đội"],
      "captions": ["pha này nhìn quen ko", "đồng đội t mỗi tối"],
      "enabled": true
    }
  ]
}
```

Đường dẫn `file` luôn tính từ thư mục `selfchat-media`. Ảnh/video quá giới
hạn `SELFCHAT_MEDIA_MAX_BYTES` sẽ bị bỏ qua. Việc chọn tệp, tag và câu dẫn
không gọi Gemini.
