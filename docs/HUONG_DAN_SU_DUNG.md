# Hướng dẫn sử dụng HBA Studio · PersonalDeadlineManagement

HBA Studio tổ chức việc học theo **không gian các môn → không gian của một môn → thẻ deadline → thông tin, tài liệu và đầu việc**. Bạn có thể giao phần lớn thao tác quản lý cho Codex trong khung chat bên phải. App dành cho một người, chạy trên máy của bạn, giao diện tiếng Việt và dùng múi giờ **Asia/Ho_Chi_Minh (UTC+7)**.

## Mục lục

- [Kết nối tài khoản](#ket-noi)

1. [Bắt đầu trong 5 bước](#bat-dau)
2. [Điều hướng và giao diện sáng/tối](#giao-dien)
3. [Việc cần làm trong Không gian](#hom-nay)
4. [Công việc, checklist và deadline](#cong-viec)
5. [Môn học, đồ án và ghi chú](#hoc-tap)
6. [Lịch thủ công và thời khóa biểu](#lich)
7. [Gợi ý ưu tiên, duyệt và hoàn tác](#lap-ke-hoach)
8. [Ghi thời gian và phiên tập trung](#thoi-gian)
9. [Tài liệu và tìm kiếm có nguồn](#thu-vien)
10. [Chat với Codex và kết nối MCP](#codex)
11. [Google Calendar và nhắc điện thoại](#google)
12. [Sao lưu, phục hồi và chạy nền](#sao-luu)
13. [Thói quen sử dụng hằng ngày](#hang-ngay)
14. [Xử lý vấn đề thường gặp](#xu-ly-loi)

<a id="ket-noi"></a>
## Kết nối tài khoản

Khi mở app lần đầu, bạn có thể kết nối **Codex** và **Google Calendar**, hoặc chọn
**Để sau / Bắt đầu, kết nối sau** để vào Không gian ngay. Không cần tạo tài khoản
hay mật khẩu HBA Studio. Mở lại ở biểu tượng tài khoản tại góc Không gian hoặc
**Tùy chọn → Tài khoản & kết nối**.

- **Codex:** bấm Kết nối Codex, hoàn tất đăng nhập bằng tài khoản ChatGPT ở trang
  nhà cung cấp. Trong Cách kết nối khác có đăng nhập bằng mã hoặc dùng phiên Codex
  đã có trên máy. App chỉ báo kết nối sau khi đã xác nhận tài khoản.
- **Google Calendar:** bấm Kết nối Google Calendar rồi chọn tài khoản và cấp quyền.
  Quyền ghi chỉ dành cho lịch riêng của app; những lịch khác được chọn chỉ dùng để
  đọc. Chọn lịch và điều chỉnh đồng bộ tại Tùy chọn → Google Calendar.
- **Ngắt kết nối:** mở màn hình kết nối, bấm Ngắt kết nối và đọc phần xác nhận.
  Ngắt Codex trong app không đăng xuất Codex CLI/IDE trên máy. Ngắt Google không
  xóa dữ liệu trên Google hoặc công việc cá nhân; bản lịch ngoài đã nhập được gỡ.
- Nếu Codex chưa được cài hoặc bản app chưa có cấu hình Google, giao diện sẽ chỉ
  rõ phần còn thiếu. Với bản phân phối đã cấu hình sẵn, bạn không cần tự tạo file
  cấu hình Google. Phần thiết lập bản phân phối do người đóng gói app thực hiện.

<a id="bat-dau"></a>
## 1. Bắt đầu trong 5 bước

Tại thư mục dự án, chạy:

```bash
bash scripts/run.sh
```

Mở **http://127.0.0.1:8765**. Lần đầu cần mạng để tải các gói phụ thuộc; máy cần có `uv`, Node.js 22 và `pnpm`. Giữ tiến trình chạy trong lúc sử dụng. Đóng tab trình duyệt không xóa dữ liệu.

1. Tab **Không gian** mở mặc định. Nhấn **Thêm môn**, hoặc mở chat **Codex** và nhờ tạo môn.
2. Kéo các thẻ môn để sắp xếp. Bấm một môn để vào không gian riêng của môn; bấm deadline để đọc thông tin, checklist và nguồn.
3. Nhấn **Thêm tài liệu** hoặc **Thêm nguồn** trong chat. Chọn nhiều file/ảnh hoặc dán nguyên tin nhắn giảng viên. Nguồn được gắn với môn/deadline đang mở.
4. Giữ lựa chọn **Nhờ Codex tổng hợp và cập nhật deadline**, rồi **Thêm và tổng hợp**. App chờ đọc nguồn xong rồi gửi yêu cầu. Ngày không rõ hoặc mâu thuẫn cần được xác nhận trong chat.
5. Xem deadline ở không gian môn và tab **Lịch**. Chế độ **AI quản lý · có hoàn tác** cho phép thêm/sửa trực tiếp; có nút **Hoàn tác** trong chat. Bỏ chọn để chỉ tạo bản nháp.

**Điều khiển mặt phẳng:** kéo nền để di chuyển; cuộn để thu phóng theo con trỏ; chụm hai ngón trên màn hình cảm ứng. Dùng nút **Vừa không gian** để thấy tất cả thẻ, **100%** để về kích thước gốc. Có thể Tab tới nút di chuyển của một thẻ rồi dùng phím mũi tên. Mỗi thẻ có thể kéo cạnh phải để đổi chiều rộng, cạnh dưới để đổi chiều cao, hoặc góc dưới phải để đổi cả hai; kích thước hiện ngay khi kéo. Có thể Tab tới tay nắm và dùng phím mũi tên, giữ Shift để chỉnh nhanh. Mỗi không gian lưu vị trí, kích thước thẻ và góc nhìn riêng trên máy; quay lại không làm mất cách sắp xếp. Mốc deadline dùng cùng dữ liệu với Lịch, không cần nhập hai lần.

**Sắp xếp tự động:** nút **Sắp xếp** ở đầu mỗi Không gian (trên thanh công cụ
trong Board công việc) mở các lựa chọn **Hàng ngang**, **Cột dọc**, **Hàng và cột**
và **Dùng Codex**. Chỉ những thẻ đang hiển thị được sắp xếp; các thẻ đang ẩn hoặc
bị lọc không đổi vị trí. Bạn thấy bố cục xem trước rồi nhấn **Áp dụng bố cục**;
**Hủy** khôi phục góc nhìn và vị trí cũ. Kích thước thẻ và nội dung được giữ nguyên.

Với **Dùng Codex**, nhấn **Nhờ Codex sắp xếp** để bắt đầu suy luận. Codex đọc
nội dung thẻ, trích đoạn tài liệu, deadline và phụ thuộc đã khai báo để đề xuất thứ
tự từ trái sang phải, trên xuống dưới; phần giải thích cho biết lý do. Có thể bật
**Thêm mũi tên trình tự** trước khi áp dụng. Mũi tên là cách biểu diễn trình tự,
không tự sửa ngày hạn hay phụ thuộc của công việc. Bật tùy chọn này khi sắp xếp
lại sẽ thay mũi tên do lần sắp xếp cũ tạo, giữ các đường nối bạn vẽ thủ công.
Có thể chọn một đường nối trên canvas để xóa.

Nút **Hoàn tác sắp xếp** khôi phục vị trí và đường nối ngay trước lần áp dụng
gần nhất trong phiên đang mở; nút chỉ dùng được khi các thẻ/bố cục chưa thay đổi
tiếp. Codex hỗ trợ tối đa 80 thẻ mỗi lần; tài liệu dài chỉ dùng trích đoạn. Nếu
Codex lỗi hoặc hết hạn mức, vẫn có thể dùng hàng/cột/lưới. AI chỉ được gọi khi bạn
nhấn nút yêu cầu, không tự chạy khi mở Không gian.

<a id="giao-dien"></a>
## 2. Điều hướng và giao diện sáng/tối

Thanh bên có **Không gian**, **Lịch** và **Codex**. Mọi phần quản lý đều nằm trong Không gian; không còn menu Thêm hoặc các trang quản lý tách rời. Chi tiết công việc, lịch và các tiện ích mở thành bảng trên canvas. Nhấn nút đóng để quay lại đúng vị trí đang xem. Trên điện thoại, chat mở toàn màn hình.

| Nút / vị trí | Dùng khi bạn muốn |
| --- | --- |
| Thẻ môn | Mở không gian của môn; dấu ba chấm trên thẻ để sửa môn |
| Thêm môn / Thêm deadline | Tạo ngay trên không gian đang mở |
| Việc cần làm, ở góc dưới | Xem thẻ deadline và công việc của mọi môn trên cùng canvas |
| Tài liệu, ở góc dưới | Xem nguồn theo môn, tìm nội dung; mở ghi chú và đồ án |
| Thay đổi, ở góc dưới | Duyệt bản nháp, xem lịch sử và hoàn tác |
| Biểu tượng mặt trăng / mặt trời | Đổi nhanh giao diện sáng/tối |
| Tùy chọn, bánh răng ở góc dưới | Nhắc việc, giao diện, Google, thư mục tài liệu và sao lưu |
| Lịch | Xem deadline, thời khóa biểu/cuộc hẹn và chỉnh màu |

Trên điện thoại, các tiện ích chỉ hiện biểu tượng để giữ canvas thoáng; tên vẫn có trong nhãn hỗ trợ tiếp cận. Nút thu phóng nằm ở góc dưới bên phải.

Giao diện dùng chữ dễ đọc, nền trắng/xám nhẹ hoặc nền tối trung tính. Tên HBA Studio và biểu tượng HBA được đóng gói trong ứng dụng để sử dụng khi mất mạng.

**Đổi nhanh sáng/tối:** nhấn biểu tượng mặt trăng/mặt trời ở góc Không gian hoặc trên đầu bảng đang mở.

**Chọn chế độ:** **Không gian → Tùy chọn → Giao diện**, chọn **Sáng**, **Tối** hoặc **Theo hệ thống**. Thay đổi có hiệu lực ngay, không cần nhấn Lưu; được nhớ trên trình duyệt hiện tại.

**Hoàn tác:** dùng nút trong thông báo sau thao tác, nút mũi tên ở góc Không gian, hoặc **Thay đổi → Lịch sử**. Chỉ thay đổi gần nhất chưa bị thay thế mới có thể hoàn tác. App tự tải lại dữ liệu định kỳ.

<a id="hom-nay"></a>
## 3. Việc cần làm trong Không gian

Nhấn **Việc cần làm** ở góc dưới để chuyển từ các môn sang canvas công việc chung. Nút này nhấn lại sẽ trở về các môn. Mỗi thẻ mở chi tiết để xem yêu cầu, nguồn và checklist; dấu ba chấm cho phép chỉnh trực tiếp.

- Dòng giải thích trên thẻ và phần thông tin chi tiết nêu lý do ưu tiên theo hạn, khối lượng và phụ thuộc.
- Dùng biểu tượng tìm kiếm để lọc tên, **Hiện đã hoàn thành** để xem cả việc đã xong, **Vừa không gian** để thấy toàn bộ thẻ.
- **Thêm công việc** tạo việc mới; **Thêm deadline** tạo mốc. Việc đã gắn deadline hoặc việc cha được xem trong chi tiết liên quan để tránh lặp nhiều thẻ.
- Muốn tổng hợp, thống kê hoặc sắp xếp thứ tự, hỏi Codex trong chat, ví dụ: “Tổng hợp deadline các môn và giải thích việc nào cần làm trước”.

<a id="cong-viec"></a>
## 4. Công việc, checklist và deadline

### Phân biệt ba khái niệm

| Khái niệm | Ví dụ | Ý nghĩa |
| --- | --- | --- |
| Deadline | Nộp đồ án trước 23:59 thứ Sáu | Mốc phải đạt |
| Công việc | Viết phần thực nghiệm, dự kiến 120 phút | Phần việc cần hoàn thành |
| Buổi làm | Thứ Ba 19:00–19:45 | Khoảng thời gian thực hiện một việc |

Một việc có thể cần nhiều buổi. Đánh dấu **Đã xong buổi** chưa tự hoàn thành công việc; đánh dấu deadline đã xong cũng không thay thế trạng thái từng việc.

### Tạo hoặc sửa công việc

1. Trong không gian môn hoặc **Việc cần làm**, nhấn **Thêm công việc**.
2. Nhập **Tên**, **Mốc deadline** nếu có và mô tả.
3. Mở **Thông tin thêm** để nhập thời lượng dự kiến, mức quan trọng, môn học, đồ án, checklist và phụ thuộc.
4. Nếu cần, nhập **Hạn riêng** trong nhóm này; hạn sớm hơn giữa việc và mốc liên quan được dùng để gợi ý thứ tự.
5. Thêm checklist hoặc mô tả, rồi nhấn **Lưu**.

Thời lượng là tùy chọn. Nếu đã nhập, HBA Studio kết hợp khối lượng còn lại với số phút có thể làm mỗi ngày để nhận biết việc cần bắt đầu sớm. Không có thời lượng vẫn nhận được gợi ý thứ tự theo hạn và phụ thuộc.

Mở một môn để lọc theo môn; canvas **Việc cần làm** gom các môn. Dùng tìm kiếm và **Hiện đã hoàn thành** để thu gọn. Nhấn thẻ để mở chi tiết trên canvas, dấu ba chấm để sửa và thùng rác trong biểu mẫu để xóa.

### Checklist, việc con và phụ thuộc

**Checklist:** thêm hoặc tick ngay trong workspace. Có thể nhập mỗi dòng một mục trong biểu mẫu công việc. Công việc, deadline và đồ án đều có đầu việc riêng; checklist không tự tạo buổi làm trên lịch.

Mở **Thông tin thêm** để:

- Gắn môn học hoặc đồ án/bài tập.
- Chọn **Thuộc công việc cha** nếu đây là việc con. Khối lượng gợi ý lấy từ các việc lá, tránh tính trùng cả cha lẫn con. Trạng thái hoàn thành của cha được phản ánh từ các con.
- Đổi trạng thái **Chưa làm / Đang làm / Hoàn thành / Đã hủy**.
- Chọn các bước trong **Cần hoàn thành trước công việc này**. Ví dụ đang sửa “Viết báo cáo”, chọn “Thực nghiệm”. Giữ Ctrl để chọn nhiều bước hoặc bỏ chọn trên máy tính.

App từ chối vòng phụ thuộc. Khi A phải xong trước B, phần gợi ý đưa A lên trước B và nêu lý do mở khóa.

### Quản lý deadline

Mở một môn để xem các mốc deadline. Nhấn **Thêm deadline** ngay ở đầu không gian môn hoặc trong canvas **Việc cần làm**.

Chọn ngày ở **Hạn hoàn thành**. Mốc được hiển thị ở hàng **Cả ngày** trên lịch; dữ liệu hạn nội bộ quy đổi ngày thành **23:59 giờ Việt Nam**. Nếu đề bài có giờ đóng nộp riêng, mở **Giờ nộp cụ thể** và nhập **Giờ nộp**; app giữ giờ này khi chỉnh các thông tin khác. Gắn môn học/đồ án nếu muốn, rồi lưu. Việc cần có **Mốc deadline** để liên kết trực tiếp; chỉ gắn cùng đồ án chưa thay cho bước liên kết này.

Mở thẻ và nhấn **Hoàn thành** để đóng mốc; **Mở lại** để tiếp tục theo dõi. Khi sửa hạn hoặc trạng thái, gợi ý thứ tự tự cập nhật.

<a id="hoc-tap"></a>
## 5. Môn học, đồ án và ghi chú

1. Ở không gian các môn, nhấn **Thêm môn**, nhập tên, học kỳ và màu nhận diện. Dấu ba chấm trên thẻ hoặc trong không gian môn dùng để sửa/xóa môn.
2. Mở môn rồi nhấn **Tài liệu** ở góc dưới. Mở nhóm **Đồ án**, chọn **Thêm đồ án**; môn hiện tại được điền sẵn. Khi mở từ trang các môn, có thể tạo đồ án độc lập.
3. Nhấn tên đồ án để mở chi tiết ngay trên canvas, gồm mô tả, checklist, nguồn và các công việc liên quan. Dùng **Chỉnh thông tin** để sửa.
4. Trong cùng bảng Tài liệu, mở **Ghi chú → Thêm ghi chú**. Ghi chú được gắn với môn/đồ án, có thể xuất hiện trong tìm kiếm và ngữ cảnh Codex. Nhấn tên ghi chú để chỉnh.

<a id="lich"></a>
## 6. Lịch của tôi và sự kiện cả ngày

Chuyển **Tháng / Tuần / Ngày**, dùng mũi tên để đổi khoảng hoặc **Hôm nay** để về hiện tại. HBA Studio nhớ chế độ xem; trên điện thoại mặc định mở Ngày để dễ thao tác.

- Deadline chỉ cần ngày, hiển thị ở hàng **Cả ngày**; bấm mốc để mở workspace.
- Sự kiện Google có ngày thay cho giờ được giữ đúng loại cả ngày. Sự kiện có giờ bắt đầu/kết thúc vẫn nằm trong lưới giờ, kể cả khi kéo dài 24 giờ.
- Mốc Google cả ngày đã có deadline nội bộ dẫn đúng link nguồn/ngày sẽ hiển thị một lần dưới dạng deadline.
- Công việc và checklist không tự được đặt vào lưới giờ. Dữ liệu buổi làm cũ được giữ; có thể bật lớp **Buổi làm** khi cần xem, mặc định lớp này tắt. Các ô **Sự kiện / Deadline** dùng để lọc nhanh trên lịch.
- Nhấn **Màu lịch** để mở bảng chỉnh màu bên phải; bảng này cho phép chọn màu từng nhóm cùng tên, kể cả sự kiện Google chỉ đọc. Đây là màu hiển thị của HBA Studio, lưu cùng workspace và bản sao lưu.
- Sự kiện cố định hoặc deadline vẫn có thể dùng màu riêng; không bị giới hạn trong màu của theme.

Nhấn **Thêm sự kiện** hoặc kéo chọn vùng trên lịch để thêm lớp học/cuộc hẹn. Bật **Cả ngày** nếu chỉ cần chọn ngày; trường kết thúc là ngày đầu tiên không còn thuộc sự kiện. Ví dụ bắt đầu 01/11 và kết thúc 03/11 nghĩa là sự kiện chiếm ngày 01 và 02/11.

### Dời giờ và thay đổi thời lượng

- Kéo thân sự kiện để dời sang giờ/ngày khác; kéo mép trên hoặc dưới để đổi thời lượng, theo bước 15 phút.
- Kéo deadline ở hàng Cả ngày hoặc trong chế độ Tháng sang ngày khác. Deadline vẫn là mốc cả ngày và giữ giờ hạn nội bộ nếu trước đó đã có giờ riêng.
- Với lịch lặp, kéo một buổi chỉ đổi buổi đó; các buổi khác trong chuỗi giữ nguyên. Ngoại lệ được gửi lên lịch Google riêng của HBA Studio.
- Trên điện thoại, nhấn giữ khoảng 350 ms rồi kéo. Cũng có thể bấm sự kiện, nhập **Bắt đầu / Kết thúc** và **Lưu thời gian**. Lịch lặp có nút **Sửa chuỗi lịch** khi muốn chỉnh toàn chuỗi.
- Sau khi đổi, dùng **Hoàn tác** trong thông báo hoặc ở góc Không gian. Nếu sự kiện đã bị sửa từ nơi khác hoặc giờ mới bị chặn, thao tác bị từ chối và lịch trở về vị trí trước đó.
- Sự kiện Google bên ngoài chỉ được đọc. Bấm sự kiện để xem thời gian và mở liên kết **Mở Google Calendar** khi cần chỉnh ở nguồn.

Lịch cố định hỗ trợ lặp hằng tuần, ngày kết thúc và ngoại lệ từng buổi. Sự kiện Google bên ngoài chỉ sửa nội dung/giờ ở Google; có thể chỉnh màu hiển thị ngay trong HBA Studio.

<a id="lap-ke-hoach"></a>
## 7. Workspace, gợi ý ưu tiên, duyệt và hoàn tác

### Workspace và agent đọc tài liệu

Bấm tên công việc, deadline hoặc đồ án/bài tập để mở trang workspace riêng. URL có dạng `#workspace/tasks/<id>` hoặc loại tương ứng, có thể tải lại, lưu bookmark và dùng Back của trình duyệt.

Mỗi công việc, deadline và đồ án có một **Board** riêng. Chọn **Board / Danh sách** ở đầu không gian; app nhớ lựa chọn cho từng việc và dùng lựa chọn gần nhất làm mặc định khi mở việc mới. Chế độ Danh sách giữ ba tab **Đầu việc / Tài liệu / Gợi ý**.

Trên Board:

- **Đầu việc** mở checklist để nhập bước mới bằng Enter, sửa, xóa hoặc đánh dấu hoàn thành. **Thẻ công việc** tạo một công việc con có không gian riêng; thẻ liên quan cho phép mở hoặc chỉnh thông tin.
- **Tài liệu** thêm nhiều file hoặc kéo file thẳng vào nền board. Mỗi file là một thẻ đọc riêng. Hỗ trợ PDF, DOCX, XLSX, Markdown và TXT, tối đa 50 MB/file.
- **Ghi chú** tạo thẻ văn bản. Tên và nội dung được lưu khi nhập.
- Kéo tiêu đề để di chuyển thẻ. Kéo cạnh phải/cạnh dưới để chỉnh riêng chiều rộng/chiều cao, hoặc góc dưới phải để chỉnh cả hai; kích thước tự lưu cho từng thẻ (đầu việc, công việc, tài liệu, ghi chú và gợi ý). Có thể focus tay nắm rồi dùng phím mũi tên; giữ Shift để tăng bước từ 10 lên 40 px. Cuộn và mức zoom bên trong tài liệu vẫn giữ khi giãn thẻ.
- Chọn **Mũi tên** hoặc **Đường thẳng**, rồi nhấn tiêu đề thẻ bắt đầu và thẻ đích. Nhấn đường nối để chọn và xóa. Đường nối chỉ biểu diễn quan hệ trên board, không tự tạo điều kiện phụ thuộc nghiệp vụ.
- Nút × trên thẻ ẩn thẻ khỏi board. **Hiện thẻ đã ẩn** đưa chúng trở lại. Nội dung và file được giữ khi ẩn.
- Chấm nhỏ ở tiêu đề thẻ dùng để **gắn thẻ vào Codex**: bấm chấm hoặc giữ rồi kéo sang khung chat. Chat tự mở khi kéo; thả vào chat để đính kèm, thả ngoài hoặc nhấn Esc để hủy. Trên điện thoại có thể bấm trực tiếp; bàn phím dùng Tab rồi Enter/Space.
- Kéo nền để di chuyển board; cuộn chuột trên nền để thu/phóng theo vị trí con trỏ, hoặc dùng nút ±; **Vừa board công việc** xem toàn bộ thẻ. Cuộn bên trong tài liệu chỉ cuộn vùng đọc đó.

Các thẻ đã chọn hiện thành nhãn `@ tên thẻ` trên ô nhập chat; gỡ từng nhãn bằng ×. Có thể chọn tối đa 20 thẻ từ nhiều không gian, không bị thêm trùng. Nhãn được giữ khi đóng chat, tải lại hoặc gửi lỗi; thẻ đã gửi xuất hiện cùng tin nhắn. Bấm/kéo thẻ chỉ chuẩn bị đính kèm, chưa gửi yêu cầu cho Codex.

Khi gửi tin nhắn, Codex nhận nội dung **đã lưu** của checklist, công việc con, ghi chú, gợi ý và tài liệu được chọn; thẻ tài liệu đi kèm các đoạn nguồn để trích dẫn. Ghi chú board được chờ lưu xong trước khi đính kèm. Với Markdown đang chỉnh sửa, hãy bấm **Lưu** nếu muốn Codex đọc phần sửa mới. Tài liệu đang xử lý cần đợi rồi gửi lại; nếu thẻ đã bị xóa, gỡ nhãn và chọn lại. Nguồn scan vẫn cần OCR/lớp chữ. Thẻ ghi chú board là nguồn tham khảo, không phải ghi chú nghiệp vụ riêng.

**Đọc tài liệu trên thẻ:** PDF cuộn liên tục qua các trang; số trang tự cập nhật khi cuộn. Có thể nhập số trang hoặc dùng nút mũi tên để nhảy nhanh, và phóng to/thu nhỏ. Trang gần vùng đọc được render rõ theo mật độ màn hình và mức zoom board. **Bôi đen chữ trong PDF rồi Ctrl/Cmd+C** để sao chép; lớp chữ đi theo mức zoom và chiều xoay của trang. PDF scan chỉ có ảnh cần OCR/lớp chữ trước khi chọn chữ.

**DOCX/Word:** Nếu chưa cài Writer, chạy `bash scripts/setup.sh --office` trước khi dùng chế độ sửa.  chọn **Chỉnh sửa** ngay trong thẻ để mở LibreOffice Writer. Thanh công cụ hỗ trợ kiểu đoạn, phông/cỡ chữ, đậm/nghiêng/gạch chân, danh sách, căn lề, bảng và hoàn tác. **Xem trước** giữ nguyên tài liệu đang soạn và khóa nhập chữ; quay lại chỉnh sửa vẫn còn vị trí và lịch sử undo. **Lưu** hoặc **Ctrl/Cmd+S** ghi lại DOCX gốc và cập nhật nguồn tìm kiếm/AI. Bạn có thể tiếp tục nhập khi đang lưu; phần nhập sau đó vẫn là bản chưa lưu. App chờ giữ bản nháp trước khi ẩn thẻ hoặc rời board. File đổi ở nơi khác sẽ hiện lựa chọn **Tải bản đang sửa** hoặc **Bỏ bản sửa, tải bản mới**. Nếu editor mở lỗi, dùng **Thử mở lại**. Engine chỉ nạp khi cần chỉnh sửa và chạy ngay trên máy; tài liệu không được gửi đến dịch vụ Office bên ngoài. Lần mở đầu cần tải bộ engine cục bộ khoảng 51 MiB từ cache app vào trình duyệt, các lần sau dùng cache. DOCX có định dạng/đối tượng nhúng đặc biệt vẫn cần kiểm tra file xuất với ứng dụng đích.

Khi thu phóng board, cả trang DOCX và thanh công cụ đều thu phóng theo thẻ, giữ tỷ lệ với thẻ và vùng đang đọc. Thanh công cụ giữ một hàng; cuộn ngang trên thanh để tìm các nút khác khi chiều rộng thẻ không đủ. **Vừa trang** căn lại trang theo chiều rộng thẻ hiện tại. Thay đổi góc nhìn không làm file chuyển sang trạng thái chưa lưu.

Người cài bản mã nguồn chạy `bash scripts/setup.sh --office` một lần rồi khởi động lại. Đây là bộ cài tùy chọn; lệnh `scripts/run.sh` mặc định chỉ cài phần cơ bản. Installer xác minh SHA-256 trước khi dùng; `PDM_OFFICE_ASSETS` trỏ đến bộ runtime đã tải để cài/chạy offline. Bộ engine browser hiện là ZetaOffice 2025-05; phiên bản LibreOffice desktop trên máy được cài độc lập.

XLSX có bộ chọn sheet, cuộn hàng/cột và nút chuyển vùng 100 hàng / 40 cột; hiển thị giá trị đã lưu, không tính lại công thức hoặc chỉnh sửa bảng tính. Biểu đồ, macro và toàn bộ định dạng Excel chưa được tái tạo. Dấu ba chấm trên thẻ có **Mở file gốc** để đối chiếu và **Tải lại tài liệu**. PDF scan vẫn đọc được trên thẻ; để tìm kiếm hoặc nhờ Codex phân tích chữ trong PDF scan, cần OCR bên ngoài.

**Markdown (.md / .markdown):** chọn **Xem trước / Chỉnh sửa** ngay trong thẻ. Xem trước hỗ trợ tiêu đề, bảng, checklist, liên kết và khối mã. Bấm **Lưu** hoặc **Ctrl/Cmd+S** để ghi vào file gốc và cập nhật chỉ mục tìm kiếm/nguồn cho AI. File thuộc thư mục theo dõi cũng được lưu tại vị trí gốc. Việc lưu không tự gọi Codex phân tích lại.

Bản sửa chưa lưu được giữ trên trình duyệt khi đổi chế độ, tải lại hoặc ẩn thẻ; preview hiển thị cả phần đang soạn. Nếu file đã thay đổi ở nơi khác, app chặn lưu đè: có thể **Tải bản đang sửa** để giữ riêng hoặc **Bỏ bản sửa, tải bản mới**. Khi lưu lỗi, bản soạn vẫn còn để thử lại. Trình chỉnh sửa hỗ trợ Markdown UTF-8 tối đa **2 MB**; TXT vẫn ở dạng đọc văn bản. HTML nhúng không được thực thi trong preview.

Nút **Tập trung** và **Hoàn thành** nằm ở đầu không gian. Mở dấu ba chấm → **Thông tin công việc** để xem hạn, mô tả, liên kết và thứ tự; cùng menu có **Chỉnh thông tin** và **Ghi thời gian**. Thông tin mở thành bảng cố định, tách khỏi các thẻ.

**Gợi ý Codex chỉ xuất hiện khi bạn chọn.** Nhấn **Gợi ý Codex** trên Board hoặc mở tab **Gợi ý** trong Danh sách để yêu cầu phân tích. Việc chỉ mở công việc hay sửa nguồn không tự gọi agent. Nếu tài liệu đang xử lý, yêu cầu chờ đến khi file đọc xong. Kết quả có dẫn nguồn và lưu ý; nút **Thêm vào đầu việc** lưu checklist sau khi bạn chọn, không tự tạo công việc con hoặc buổi làm. **Đọc lại** yêu cầu cập nhật kết quả khi cần.

File được gắn với đúng công việc. Agent cũng có thể đọc tài liệu của deadline/đồ án liên quan, môn học và tài liệu dùng chung. File gắn riêng với việc không liên quan được loại khỏi ngữ cảnh.

Cần `codex` trong PATH và đã `codex login`. Agent dùng đăng nhập Codex hiện có, chạy chế độ chỉ đọc với kết quả JSON có schema. Nội dung nguồn liên quan được gửi qua dịch vụ Codex và sử dụng quota tài khoản. Các bước không có đủ bằng chứng sẽ được báo thiếu nguồn. Lỗi đăng nhập, mạng/quota hoặc đọc file hiện trong workspace. Có thể đặt `PDM_AGENT_ENABLED=0` để tắt agent tự động; công việc, checklist và gợi ý thứ tự vẫn hoạt động.

Kết quả được lưu để không gọi agent lại khi nội dung chưa thay đổi. Với tài liệu dài, agent đọc một phần trong giới hạn ngữ cảnh và hiển thị cảnh báo; hãy kiểm tra đề bài gốc để bảo đảm đầy đủ.

### Thứ tự nên làm

Lý do trên thẻ trong Không gian và thứ tự gợi ý trong chi tiết công việc dùng cùng dữ liệu cập nhật. HBA Studio xét hạn sớm nhất, mức quan trọng, khối lượng còn lại, thời gian đã ghi và quan hệ phụ thuộc. Bước tiên quyết được làm trước việc nó mở khóa; lý do hiển thị dưới từng việc.

Vào **Không gian → Tùy chọn → Ưu tiên & nhắc việc** để đặt khối lượng có thể làm mỗi ngày (mặc định 240 phút). Không cần khai báo giờ trống để dùng gợi ý. Đây là gợi ý theo quy tắc, không bảo đảm thứ tự tối ưu cho mọi tình huống; agent giải thích thêm từ đề bài và các deadline hiện tại.

### Bản nháp và hoàn tác

Các thay đổi nghiệp vụ Codex gửi qua MCP nằm trong **Không gian → Thay đổi → Chờ duyệt**. Kiểm tra nội dung, dùng **Chỉnh thay đổi này** khi cần, rồi **Áp dụng thay đổi** hoặc **Bỏ qua**. Lịch sử lưu các bản đã xử lý. Nếu dữ liệu đổi tiếp, bản nháp cũ có thể bị từ chối.

Nút **Hoàn tác** dùng cho lần thay đổi gần nhất còn hợp lệ. API lập lịch cũ được giữ để tương thích tích hợp; giao diện chính dùng workspace và thứ tự ưu tiên.

<a id="thoi-gian"></a>
## 8. Ghi thời gian và phiên tập trung

Mở một công việc lá đã lưu:

- **Tập trung:** bắt đầu phiên, một thanh ở cuối màn hình hiện tên việc và giờ bắt đầu. Nhấn **Kết thúc & ghi giờ** để lưu số phút thực tế. App chỉ cho chạy một phiên tại một thời điểm; phiên được nhớ trên trình duyệt khi tải lại trang.
- **Ghi thời gian:** nhập số phút đã làm và ghi chú rồi Lưu, phù hợp khi bạn làm ngoài app.

Thời gian thực tế giúp tính khối lượng còn lại trong gợi ý ưu tiên. Bạn vẫn cần tự đánh dấu công việc hoàn thành khi kết quả đã xong. Tránh ghi hai phiên trùng cho cùng một khoảng làm để không cộng dư thời gian.

<a id="thu-vien"></a>
## 9. Tài liệu và tìm kiếm có nguồn

### Thêm file

Nhấn **Thêm tài liệu** trên canvas hoặc trong bảng **Tài liệu**, chọn **PDF, DOCX, XLSX, Markdown, TXT hoặc ảnh PNG/JPG/WebP**. Có thể dán tin nhắn giảng viên và nhờ Codex tổng hợp. Giới hạn 50 MB/file. Đợi trạng thái **Sẵn sàng** trước khi tìm kiếm; lỗi đọc file được hiển thị ngay trên dòng tài liệu. PDF scan đọc trực tiếp được trên Board; phần tìm kiếm và phân tích chữ cần OCR bên ngoài.

Nếu muốn gắn file mới với môn/đồ án, mở **Lọc theo môn học / đồ án**, chọn trước khi tải lên. Có thể đổi môn học của file sau đó từ danh sách. Nút gỡ áp dụng cho bản tải lên; không dùng để xóa file gốc trong thư mục theo dõi.

### Theo dõi thư mục

Trong **Không gian → Tùy chọn → Tài liệu**, nhập tên nguồn và đường dẫn thư mục tuyệt đối trên máy chạy backend, rồi **Thêm nguồn**. Ví dụ `/home/ban/TaiLieu/HocKy1`.

App chỉ đọc nguồn gốc, quét lúc chạy và khoảng mỗi phút; **Quét lại** yêu cầu kiểm tra ngay. File không đổi được bỏ qua theo mã băm; file sửa được lập chỉ mục lại. File bị xóa trong nguồn đang truy cập được sẽ bị gỡ khỏi chỉ mục. Nguồn tạm mất kết nối được báo lỗi/mất nguồn, không tự xem toàn bộ file là đã xóa. App bỏ qua symlink, thư mục ẩn và một số thư mục cache.

### Tìm và kiểm tra dẫn chứng

1. Nhập câu hỏi hoặc từ khóa trong **Tìm tài liệu**, có thể tìm tiếng Việt không dấu.
2. Dùng bộ lọc môn/đồ án nếu cần, rồi **Tìm kiếm**.
3. Nhấn kết quả để mở **Đoạn nguồn**: nội dung, trang/đoạn, đường dẫn, phiên bản nội dung và thời điểm lập chỉ mục.

Tìm từ khóa hoạt động khi chưa tải mô hình. Muốn tìm theo ý nghĩa, mở **Không gian → Tùy chọn → Tài liệu → Tìm kiếm theo ngữ nghĩa**, chọn **Tải mô hình tìm kiếm** và bật tìm kiếm ngữ nghĩa. Mô hình `intfloat/multilingual-e5-small` tải một lần rồi chạy CPU tại máy; chờ các đoạn được xử lý. Kết quả cho biết đang dùng **Từ khóa** hay **Từ khóa + ngữ nghĩa**.

Khi Codex dùng tài liệu, yêu cầu dẫn chứng và phân biệt thông tin trong nguồn với suy luận. Trong chat, deadline tìm thấy trong đề bài được lưu theo chế độ AI quản lý bạn chọn; với chế độ bản nháp hoặc MCP, cần duyệt đề xuất trước. Trạng thái công việc phải lấy từ dữ liệu app hiện tại, không từ một đoạn tài liệu cũ.

<a id="codex"></a>
## 10. Chat với Codex và kết nối MCP

Nhấn **Codex** trên thanh bên trái để mở/đóng khung chat. Khung chat mở sẵn khi dùng lần đầu trên máy tính. Trên điện thoại, dùng biểu tượng hội thoại. Nhấn **×** hoặc **Esc** để đóng; cuộc trò chuyện và nội dung đang soạn được giữ lại. Đóng khung chat không dừng lượt trả lời đang chạy.

- Nhập yêu cầu và nhấn **Enter** để gửi; **Shift + Enter** xuống dòng.
- Có thể hỏi về việc nên làm trước, deadline, môn học, đồ án, tài liệu hoặc nhờ chuẩn bị thay đổi.
- Chat biết bạn đang ở toàn bộ môn học, trong một môn hay trong deadline. Tùy chọn **Đính kèm** gửi liên kết đối tượng đang mở làm ngữ cảnh. Có thể bỏ chọn để hỏi chung.
- Nút hình vuông **Dừng trả lời** ngắt lượt đang chạy; lịch sử phần đã nhận vẫn được giữ.
- Nút **+** bắt đầu cuộc trò chuyện mới; danh sách phía trên cho phép mở lại cuộc trò chuyện cũ, kể cả sau khi tải lại trang hoặc khởi động lại app.
- **AI quản lý · có hoàn tác**: thêm/sửa môn, đồ án, deadline, công việc, ghi chú được lưu ngay sau kiểm tra nghiệp vụ. Thẻ thay đổi ghi **Đã áp dụng** và có nút **Hoàn tác**. Nếu dữ liệu đã đổi tiếp, app báo không thể hoàn tác lùi qua thay đổi mới.
- Bỏ chọn AI quản lý để **Chỉ tạo bản nháp**. Các lô có xóa dữ liệu, sửa lịch hoặc ghi thời gian luôn cần duyệt tại **Không gian → Thay đổi**; bản nháp chưa thay đổi dữ liệu chính thức.
- **Thêm nguồn** nhận PDF, DOCX, XLSX, TXT/Markdown, ảnh PNG/JPG/WebP hoặc tin nhắn dán. Ảnh được đọc qua Codex; PDF scan vẫn cần OCR bên ngoài. Liên kết được lưu làm nguồn, không tự tải nội dung phía sau trang/đăng nhập.
- Mở **nguồn đã tra cứu** để đọc lại đoạn tài liệu. Các nguồn này là những đoạn Codex đã đọc; hãy kiểm tra bằng chứng trước khi áp dụng.

Chat dùng [Codex App Server](https://learn.chatgpt.com/docs/app-server) và phiên đăng nhập Codex CLI trên máy. Cần `codex` trong PATH, đã chạy `codex login` và có mạng/quota. Không cần thêm API key. Nếu lỗi kết nối, tin nhắn đang soạn được giữ để gửi lại. `PDM_AGENT_ENABLED=0` tắt cả chat và agent workspace. Lịch sử lưu tại máy trong cơ sở dữ liệu của HBA Studio; phiên Codex tương ứng được CLI lưu tại máy. Nội dung tin nhắn và dữ liệu được tra cứu gửi qua dịch vụ Codex để xử lý.

### Dùng Codex bên ngoài qua MCP

Khởi động app trước. Tại thư mục dự án chạy:

```bash
bash scripts/connect-codex.sh
```

Mở phiên Codex mới để nạp MCP `personal-deadline-management`. Cũng có thể xem lệnh tại **Không gian → Tùy chọn → Codex**. Cách kết nối này dùng khi muốn quản lý HBA Studio từ phiên Codex CLI/IDE bên ngoài.

Codex có thể đọc ngữ cảnh kế hoạch, tìm tài liệu, đọc đoạn nguồn, tạo bản nháp thay đổi và gọi bộ lập lịch. **Codex không có công cụ áp dụng bản nháp**; bạn mở web để xem và áp dụng.

Các câu lệnh gợi ý:

> Đọc ngữ cảnh hiện tại. Tuần này tôi nên làm gì trước, vì sao? Nêu việc đang bị chặn và deadline có nguy cơ trễ.

> Tìm đề bài đồ án trong Không gian, dẫn nguồn và đề xuất các bước có thời lượng, quan hệ phụ thuộc và mốc hạn. Gửi bản nháp, chưa áp dụng.

> Đọc đề bài liên quan, chỉ rõ các đầu việc và dẫn nguồn; gợi ý nên làm deadline nào trước.

> Tìm yêu cầu về phần báo cáo trong tài liệu môn học, trích đoạn và cho biết trang hoặc đề mục.

> Với khối lượng còn lại hiện tại, deadline nào cần bắt đầu sớm? Giải thích các bước đang chờ phụ thuộc.

Sau khi Codex tạo nháp, đợi app tự tải lại, mở **Không gian → Thay đổi → Chờ duyệt**. Kiểm tra ước lượng AI, liên kết và phụ thuộc trước khi áp dụng.

Dữ liệu app và embedding lưu tại máy. Các đoạn trích được gửi cho Codex vẫn được xử lý qua dịch vụ AI của phiên Codex; tích hợp này không yêu cầu thêm OpenAI API key. Quyền sử dụng/quota Codex phụ thuộc tài khoản hiện có. Các chức năng công việc/lịch nội bộ không yêu cầu thuê máy chủ; dùng khi mất mạng được, còn Codex và đồng bộ Google cần mạng.

<a id="google"></a>
## 11. Google Calendar và nhắc điện thoại

### Kết nối

1. Trong Google Cloud Console, tạo/chọn project và bật Google Calendar API.
2. Cấu hình OAuth consent; nếu ứng dụng đang ở Testing, thêm tài khoản đăng nhập vào **Google Auth Platform → Audience → Test users**.
3. Tạo OAuth client loại **Desktop app**, tải file JSON.
4. Vào **Không gian → Tùy chọn → Google Calendar → Cấu hình kết nối Google**, chọn JSON, rồi **Kết nối Google**. Đăng nhập bằng trình duyệt trên máy đang chạy app.
5. Sau kết nối, app tạo lịch riêng **PersonalDeadlineManagement**. Mở **Lịch khác dùng để đọc giờ bận**, chọn lịch cần tránh và nhấn **Lưu lịch đọc giờ bận**.

Không cần thực hiện lại nếu app đã báo Đã kết nối. Khi thông tin đăng nhập hết hiệu lực, dùng **Đăng nhập lại**. Chi tiết OAuth nằm trong tài liệu `docs/GOOGLE_CALENDAR.md` của dự án.

### Đồng bộ từ app lên Google và chiều ngược lại

- **App → Google:** lưu/kéo thả sự kiện hoặc deadline trong app. Thay đổi được gộp khoảng 10 giây trước khi gửi; nếu chỉnh liên tục, lượt gửi được xếp sau tối đa khoảng 30 giây, trừ khi đang chờ mạng/hạn mức. Kiểm tra mục đó trên lịch PersonalDeadlineManagement trong Google Calendar.
- **Google → App:** dời buổi trên lịch riêng bằng điện thoại/web Google Calendar; khi đồng bộ, app cập nhật giờ và khóa buổi để giữ lựa chọn của bạn. Dời mốc deadline cả ngày cập nhật ngày hạn tương ứng.
- Xóa một buổi trên Google giữ lại công việc, để phần chưa đủ lịch có thể được xếp lại. Xóa mốc trên Google không xóa deadline nội bộ.
- Nếu hai nơi cùng sửa một mục, vào **Không gian → Tùy chọn → Google Calendar**, xem xung đột rồi chọn **Giữ trong app** hoặc **Giữ Google**.
- Các lịch Google khác được chọn chỉ dùng để đọc giờ bận; app không ghi thay đổi lên các lịch đó.

Worker cần app đang chạy và có mạng. Khi mất mạng, thay đổi chờ gửi lại; xem trạng thái/lỗi và thời điểm đồng bộ cuối trong Tùy chọn. Không cần bấm Đồng bộ liên tục.

### Đồng bộ tự động và tiết kiệm lượt gọi API

Trạng thái Google nằm ngay trên **Lịch của tôi**. Mở **Tùy chọn đồng bộ** để bật/tạm dừng tự động, đổi chu kỳ lấy thay đổi từ Google (mặc định khoảng **15 phút**) và xem lượt gọi HBA Studio đã dùng. Chu kỳ có độ lệch nhỏ để tránh dồn yêu cầu. Khi tạm dừng, thay đổi vẫn lưu tại máy và có thể dùng **Đồng bộ ngay** cho một lượt thủ công.

HBA Studio chỉ lấy phần thay đổi bằng sync token; giữ phân trang và xử lý token hết hạn theo [hướng dẫn đồng bộ Google](https://developers.google.com/workspace/calendar/api/guides/sync). Mở lịch, chuyển tháng/tuần và tự làm mới giao diện đọc dữ liệu tại máy. Danh sách lịch Google được lưu đệm 24 giờ.

HBA Studio tự đặt trần **30 lượt/phút và 5.000 lượt/ngày (UTC)** cho tất cả yêu cầu Calendar API của mình, kể cả yêu cầu thất bại. Chạm trần thì chờ sang cửa sổ tiếp theo; số đếm và lịch thử lại được lưu sau khi khởi động lại. Nút **Đồng bộ ngay** cách nhau tối thiểu một phút và không bỏ qua hạn mức hay thời gian chờ. Khi Google trả lỗi giới hạn, HBA Studio tôn trọng `Retry-After` và tăng dần thời gian chờ, theo [hướng dẫn hạn mức Google](https://developers.google.com/workspace/calendar/api/guides/quota).

Đây là trần bảo vệ riêng của HBA Studio. Nó không đo tổng lượt gọi từ ứng dụng khác dùng chung Google Cloud project. Với một lịch riêng và một lịch đọc thêm, chu kỳ 15 phút thường cần khoảng 192 lượt đọc/ngày nếu mỗi lịch có một trang dữ liệu, cộng các lượt ghi khi có thay đổi. Kết nối hiện chạy tại localhost; thông báo push của Google cần [địa chỉ nhận HTTPS](https://developers.google.com/workspace/calendar/api/guides/push), nên bản này dùng đồng bộ tăng dần theo chu kỳ, không yêu cầu mở máy ra Internet.

### Nhắc điện thoại

Trên Google Calendar điện thoại, bật hiển thị, đồng bộ và thông báo cho lịch PersonalDeadlineManagement; cho phép thông báo của ứng dụng trong cài đặt điện thoại.

Mặc định buổi làm nhắc trước **15 phút**, deadline trước **24 giờ và 2 giờ**. Sửa tại **Không gian → Tùy chọn → Ưu tiên & nhắc việc → Nhắc việc**, nhập phút cách nhau bằng dấu phẩy cho deadline, rồi **Lưu cài đặt**. Deadline được gửi dưới dạng sự kiện Cả ngày không chiếm giờ bận.

Sau khi sự kiện đã đồng bộ, điện thoại xử lý nhắc theo cài đặt Google/thiết bị kể cả khi máy tính tắt. Thay đổi mới sẽ chỉ được gửi khi dịch vụ trên máy tính hoạt động. Nên tự thử một buổi sau ít nhất 20 phút để kiểm tra nhắc thực tế.

<a id="sao-luu"></a>
## 12. Sao lưu, phục hồi và chạy nền

### Sao lưu

Vào **Không gian → Tùy chọn → Sao lưu → Sao lưu ngay**, rồi nhấn file trong danh sách để tải ZIP. Khi dịch vụ chạy, app tự sao lưu hằng ngày và giữ bảy bản gần nhất.

| Được đưa vào ZIP | Cần quản lý riêng |
| --- | --- |
| Database: công việc, lịch, môn/đồ án, đề xuất, liên kết | File gốc trong thư mục theo dõi |
| Các file tải lên app | OAuth client/token Google và cache mô hình |

Dữ liệu mặc định nằm tại `~/.local/share/personal-deadline-management/`; môi trường Python và cache nằm tại `~/.cache/personal-deadline-management/`. Nên lưu một bản ZIP trên thiết bị khác.

### Phục hồi

Dừng dịch vụ trước khi chuyển workspace. Phục hồi vào **thư mục mới, trống** bằng terminal tại thư mục dự án:

```bash
bash scripts/restore.sh /duong-dan/workspace-....zip --destination /home/ban/pdm-restored
PDM_DATA_DIR=/home/ban/pdm-restored bash scripts/run.sh
```

Không chạy hai backend trên cùng thư mục dữ liệu. Kiểm tra công việc, lịch và file tải lên trong workspace phục hồi. Các nguồn thư mục ngoài cần còn truy cập được ở đường dẫn tương ứng.

Kết nối Google được ngắt trong bản phục hồi để tránh tự gửi dữ liệu cũ lên lịch thật. Kết nối lại sẽ tạo lịch riêng mới; kiểm tra lịch cũ trong Google để tránh hiển thị hai bản. Giữ bản sao lưu cũ cho đến khi đã kiểm tra xong.

### Chạy cùng phiên đăng nhập Linux

Sau khi chạy thủ công thành công, dừng tiến trình thủ công rồi cài dịch vụ:

```bash
bash scripts/install-service.sh
systemctl --user status personal-deadline-management
```

Xem log hoặc tắt dịch vụ:

```bash
journalctl --user -u personal-deadline-management -n 80
systemctl --user disable --now personal-deadline-management
```

Dịch vụ theo phiên người dùng; không đồng bộ thay đổi mới khi máy tắt hoặc ngủ. Nếu đã cài dịch vụ, dùng dịch vụ thay cho mở thêm một bản `scripts/run.sh`.

<a id="hang-ngay"></a>
## 13. Thói quen sử dụng hằng ngày

**Đầu ngày:** mở Không gian, xem hạn gần nhất trên các môn hoặc nhấn Việc cần làm. Hỏi Codex việc nào nên làm trước; mở thẻ để đọc đề bài và checklist.

**Khi làm việc:** mở việc → Tập trung, kết thúc để ghi phút thực tế; tick checklist và hoàn thành việc khi có kết quả. Thêm ghi chú và tài liệu khi yêu cầu thay đổi.

**Cuối ngày:** ghi thời gian thực tế, tick checklist và xem lại deadline còn mở; gợi ý thứ tự sẽ cập nhật.

**Cuối tuần:** mở Tổng kết 7 ngày, xem deadline sắp tới, điều chỉnh ước lượng và tải một bản sao lưu ra ngoài máy.

<a id="xu-ly-loi"></a>
## 14. Xử lý vấn đề thường gặp

| Hiện tượng | Cách kiểm tra |
| --- | --- |
| Không mở được app | Kiểm tra terminal/dịch vụ đang chạy và dùng đúng `http://127.0.0.1:8765`; không khởi động thêm bản dùng chung database |
| Chưa thấy giao diện mới | Tải lại trang; nếu còn cache cũ, dùng Ctrl+Shift+R |
| Chưa biết tìm trường môn/đồ án/phụ thuộc | Trong biểu mẫu công việc, mở Thông tin thêm |
| Không thấy deadline hoặc lịch sử đề xuất | Mở môn hoặc Việc cần làm; lịch sử ở nút Thay đổi → Lịch sử |
| Agent chưa trả kết quả | Kiểm tra `codex login status`, mạng/quota, trạng thái đọc file; dùng Đọc lại trong tab Gợi ý |
| Chưa thấy gợi ý thứ tự | Thêm deadline/công việc còn mở; kiểm tra hạn và các bước phụ thuộc |
| Bản nháp không áp dụng được | Dữ liệu có thể đã đổi; tạo lại phương án và kiểm tra cảnh báo |
| Không tìm được tài liệu | Đợi Sẵn sàng, bỏ lọc, thử từ khóa ngắn/không dấu; kiểm tra file hoặc nguồn thư mục và trạng thái mô hình |
| PDF không đọc được | Kiểm tra có lớp chữ và không bị mã hóa; PDF scan cần OCR bên ngoài |
| Codex chưa thấy MCP | Chạy script kết nối khi app đang chạy và mở phiên Codex mới |
| Google báo 403 access_denied khi Testing | Thêm đúng tài khoản đăng nhập vào Test users của đúng project chứa OAuth client JSON, rồi thử kết nối lại |
| Google hết phiên đăng nhập | Dùng Đăng nhập lại; OAuth ở chế độ Testing có thể cần cấp quyền lại sau bảy ngày |
| Google chưa nhận thay đổi | Kiểm tra mạng, trạng thái kết nối, lỗi, đồng bộ cuối và đúng lịch riêng; nhấn Đồng bộ |
| Điện thoại không nhắc | Kiểm tra sự kiện đã xuất hiện trên lịch Google, bật đồng bộ/nhắc cho lịch riêng và cấp quyền thông báo của ứng dụng |
| Theme trở về mặc định | Kiểm tra đang dùng đúng trình duyệt, chế độ riêng tư hoặc đã xóa dữ liệu lưu; chọn lại ở Không gian → Tùy chọn → Giao diện |

V1 chưa có OCR tự động, ứng dụng điện thoại riêng, nhiều người dùng, Google Drive/Notion hoặc quản lý GPA. Điện thoại nhận lịch và nhắc qua Google Calendar; web hiện mặc định chỉ mở tại máy qua địa chỉ loopback.
