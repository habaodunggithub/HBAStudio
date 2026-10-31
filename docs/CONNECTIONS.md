# Kết nối tài khoản trong bản app cá nhân

HBA Studio hiện là app chạy trên máy riêng, không phải dịch vụ nhiều tài khoản
chung một server. Người dùng không cần tạo mật khẩu HBA Studio. Màn hình chào mừng
cho phép kết nối từng dịch vụ hoặc bắt đầu làm việc ngay; mở lại bằng biểu tượng
tài khoản ở góc Không gian hoặc **Tùy chọn → Tài khoản & kết nối**.

## Codex

- **Kết nối Codex** mở trang đăng nhập ChatGPT. Có thể mở **Cách kết nối khác →
  Đăng nhập bằng mã** nếu trình duyệt không hoàn tất được luồng thông thường.
- Chỉ chuyển sang tài khoản mới khi App Server báo hoàn tất và `account/read`
  xác nhận có tài khoản. Hủy, hết hạn hoặc lỗi giữ nguyên kết nối cũ. Đóng màn hình
  kết nối không dừng việc xác nhận đăng nhập ở backend.
- Phiên đăng nhập mới được giữ trong thư mục `codex/` thuộc thư mục dữ liệu app,
  quyền thư mục 0700, dùng credential store dạng file. Không sao chép token của
  phiên Codex CLI/IDE. Chat, phân tích tài liệu và đọc ảnh cùng dùng lựa chọn này.
- Bản app đã dùng phiên trên máy trước đây tiếp tục dùng phiên đó. Nút **Dùng
  Codex đã đăng nhập trên máy** cũng có thể chọn lại cách này. Ngắt kết nối chỉ
  bỏ liên kết trong HBA; không gọi logout đối với phiên hệ thống.
- Đổi kết nối khi đang trả lời/phân tích bị chặn. Lịch sử chat trong app được giữ;
  thread của provider cũ không được resume bằng tài khoản/kho phiên mới.
- Kiểm tra trạng thái không gửi lượt suy luận AI. API chỉ trả các trường tài khoản
  cần hiển thị, không trả token. Bản local cần có lệnh `codex` trong PATH; bộ đóng
  gói cần cài/kèm Codex phù hợp với nền tảng.

Triển khai theo [Codex App Server: auth/account](https://learn.chatgpt.com/docs/app-server).
Nếu sau này chuyển sang website hosted, cần đổi thiết kế xác thực/tách dữ liệu và
xem [Sign in with ChatGPT](https://developers.openai.com/siwc); không mở bản localhost
hiện tại ra Internet để dùng chung.

## Google Calendar

Người đóng gói app cấu hình OAuth Desktop client **một lần**, bật Calendar API và
hoàn tất consent/publishing tương ứng trước khi phân phối rộng. Người dùng bản đã
cấu hình chỉ bấm kết nối rồi chọn tài khoản/cấp quyền trên trang Google.

Cung cấp file qua `PDM_GOOGLE_CLIENT_FILE=/duong-dan/google-client.json` hoặc đặt
file cấu hình tại `resources/google-client.json` khi đóng gói. Bản mẫu nằm tại
`resources/google-client.example.json`; không chứa client thật. Cấu hình người dùng
đã thêm trong thư mục dữ liệu được ưu tiên hơn cấu hình đi kèm app. Không đóng gói
`google-token.json`, token Codex, DB hoặc dữ liệu cá nhân của người phát triển.

Nếu bản app chưa có cấu hình, giao diện thông báo rõ và cho mở phần thêm cấu hình
riêng; không báo kết nối thành công giả. Nút đăng nhập mở cửa sổ trình duyệt; nếu
popup bị chặn, chuyển hướng trong trang hiện tại. Callback quay lại màn hình kết
nối, có kiểm tra state/giới hạn 10 phút kể cả khi người dùng từ chối cấp quyền.

Khi đăng nhập lại, app xác nhận tài khoản bằng quyền Calendar đã có: cùng tài
khoản giữ mapping; đổi tài khoản gỡ mapping/cache lịch ngoài cũ để không sử dụng
ID lịch của tài khoản trước. Công việc cá nhân và dữ liệu trên Google vẫn được giữ.
Xác nhận tài khoản hoạt động cả khi chưa có kết nối nào. Đăng nhập lại không bị
chặn bởi thời gian chờ của token cũ, nhưng vẫn tôn trọng hạn mức phút/ngày đã dùng.
Nếu đổi mã hoặc xác nhận tài khoản thất bại, phiên OAuth được bỏ để lần thử sau
nhận mã mới; callback quay về màn hình kết nối với thông báo thay vì JSON lỗi.

Quyền được giữ theo luồng cũ: tạo/ghi lịch riêng của app, đọc danh sách lịch và
đọc sự kiện trên các lịch được chọn. Chọn lịch đọc/tần suất/quota/xử lý xung đột ở
**Google Calendar** trong Tùy chọn. Không yêu cầu quyền chỉnh sửa mọi lịch.

Tham khảo [OAuth Desktop](https://developers.google.com/identity/protocols/oauth2/native-app)
và [Calendar scopes](https://developers.google.com/workspace/calendar/api/auth).

## Module và kiểm tra

`codex_runtime.py` chọn môi trường, `codex_auth.py` quản lý phiên đăng nhập,
`connections.py` cung cấp REST; frontend nằm trong `src/connections/`. Giữ nguyên
middleware chỉ phục vụ localhost và cookie phiên local. Không thêm DB migration.

Kiểm thử trạng thái provider bằng mock để tránh đăng xuất/đổi tài khoản hoặc tiêu
quota AI thật. Đăng nhập cấp quyền thật vẫn cần tài khoản và thao tác trực tiếp của
người dùng trên trang nhà cung cấp.
