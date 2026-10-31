# Kết nối Google Calendar

1. Tạo/chọn project trong Google Cloud Console, bật **Google Calendar API**.
2. Cấu hình OAuth consent cho tài khoản của bạn. Nếu ở Testing, thêm chính tài khoản đó vào Test users.
3. Tạo OAuth client loại **Desktop app**, tải JSON. Không đưa JSON/token lên Git.
4. Chạy app ở `http://127.0.0.1:8765`. Vào **Cài đặt → Google Calendar**, tải JSON rồi nhấn **Kết nối Google**. Trình duyệt hệ thống xử lý đăng nhập; callback về loopback.
5. Sau kết nối, worker tạo lịch **PersonalDeadlineManagement**. Chọn những lịch khác cần đọc giờ bận, nhấn **Lưu lịch đọc giờ bận**.
6. Trên Google Calendar điện thoại, bật đồng bộ và thông báo cho lịch mới. Tạo một buổi cách hiện tại ít nhất 20 phút, đồng bộ, kiểm tra nhắc 15 phút trước buổi. Kiểm tra thêm việc dời buổi từ điện thoại về app.

App yêu cầu quyền quản lý lịch do chính app tạo, đọc danh sách lịch và đọc sự kiện. Không sửa các lịch cá nhân khác. Token lưu trong thư mục dữ liệu private, quyền file 0600, không nằm trong bản sao lưu.

Mốc deadline xuất thành sự kiện 1 phút có `transparency=transparent`, không chiếm giờ bận. Nhắc mặc định trước deadline 24 giờ và 2 giờ. Buổi làm nhắc trước 15 phút. Sau khi đồng bộ, Google/điện thoại chịu trách nhiệm nhắc; máy tính tắt sẽ không gửi thay đổi mới.

Worker mặc định đồng bộ tăng dần khoảng 15 phút/lần khi dịch vụ chạy; có thể đổi chu kỳ trong Tùy chọn. Hàng đợi gửi lại khi mất mạng và phát hiện xung đột bằng baseline/ETag. Nếu cùng sửa một mục ở hai nơi, chọn phiên bản trong Cài đặt. Xóa buổi Google không xóa task; xóa mốc Google không xóa deadline nội bộ. Hết hạn sync token chỉ làm tải lại phần lịch.

OAuth ở trạng thái Testing có thể cấp refresh token chỉ tồn tại 7 ngày. Khi bị thu hồi/hết hạn, nhấn **Đăng nhập lại**. Muốn dùng ổn định lâu dài, cấu hình publishing status phù hợp với ứng dụng cá nhân và yêu cầu của Google; không xem việc có client JSON là bằng chứng đã kết nối được.

Nguồn: [OAuth desktop](https://developers.google.com/identity/protocols/oauth2/native-app), [sync](https://developers.google.com/workspace/calendar/api/guides/sync), [reminders](https://developers.google.com/workspace/calendar/api/concepts/reminders).
