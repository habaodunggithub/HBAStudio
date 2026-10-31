# Cấu trúc mã nguồn HBA Studio

## Ranh giới chính

Frontend React/TypeScript gọi REST `/api/v1`. Backend FastAPI giữ dữ liệu SQLite,
file gốc và chỉ mục tìm kiếm trên máy. `backend/domain.py` sở hữu thay đổi nghiệp
vụ, revision và đề xuất; `backend/canvas.py` chỉ lưu bố cục board, độc lập với
revision nghiệp vụ. Không đưa thao tác lưu bố cục qua luồng sửa deadline/task.

| Phần | Trách nhiệm |
| --- | --- |
| `frontend/src/main.tsx`, `App.tsx` | Điểm khởi động và khung ứng dụng/điều hướng |
| `frontend/src/workspace/` | Biểu mẫu chỉnh sửa thực thể, văn bản liên kết và danh sách ưu tiên |
| `backend/app.py`, `routes/` | App factory, lifecycle và 10 nhóm HTTP router; giữ hợp đồng method/path |
| `backend/config.py`, `security.py`, `cli.py` | Cấu hình dùng chung, ranh giới localhost và lệnh `pdm` |
| `frontend/src/WorkWorkspace.tsx` | Dữ liệu công việc, checklist, phân tích theo yêu cầu và chọn Board/Danh sách |
| `frontend/src/WorkBoard.tsx` | Tương tác kéo, nối, resize và dựng thẻ trên board |
| `frontend/src/board/model.ts` | Kiểu layout/patch, gộp map và xử lý dấu xóa `null` |
| `frontend/src/board/saveQueue.ts` | Tuần tự hóa ghi, gộp thay đổi mới, giữ patch khi lỗi |
| `frontend/src/board/useWorkBoard.ts` | Kết nối React với API, debounce, vòng đời và lưu khi rời board |
| `frontend/src/board/geometry.ts` | Vị trí mặc định, zoom theo con trỏ, đầu mút đường nối |
| `frontend/src/board/arrangement.ts`, `ArrangeControl.tsx` | Xếp hàng/cột/lưới, xem trước, kiểm tra thay đổi và hoàn tác bố cục |
| `backend/arrangement.py` | Đọc thẻ từ dữ liệu gốc, gọi Codex chỉ khi được chọn, kiểm tra thứ tự và đường nối; không ghi dữ liệu |
| `frontend/src/DocumentReader.tsx` | Chọn định dạng, tải reader khi cần, cô lập render bằng props đơn giản |
| `frontend/src/documents/` | Controller DOCX/Markdown, preview DOCX, phân trang và tiện ích file dùng chung |
| `frontend/src/PDFReader.tsx` | Cuộn liên tục, canvas theo vùng nhìn, độ phân giải và lớp chọn chữ PDF |
| `frontend/src/DOCXReader.tsx`, `MarkdownReader.tsx` | Giao diện reader; trạng thái lưu/bản nháp nằm trong hook riêng |
| `frontend/src/docx-editor-frame.ts` | Bridge Writer trong iframe, hàng đợi load/export/snapshot và nhập Unicode; chỉ nạp khi chỉnh sửa |
| `frontend/public/office/writer-worker.js` | Mô hình tài liệu LibreOffice UNO, lệnh định dạng, layout, undo và xuất DOCX bằng filter gốc |
| `backend/office_runtime.py`, `resources/office-runtime.json` | Phục vụ bộ engine cục bộ được pin SHA-256; không tải runtime khi mở tài liệu |
| `frontend/src/api.ts` | HTTP/JSON, FormData, hủy yêu cầu và `ApiError.status` thống nhất |
| `frontend/src/connections/` | Thiết lập lần đầu, trạng thái và thao tác kết nối Codex/Google |
| `backend/connections.py`, `codex_auth.py` | REST và vòng đời đăng nhập Codex theo xác nhận của provider |
| `backend/codex_runtime.py` | Chọn phiên hệ thống hoặc kho đăng nhập riêng cho app, dùng chung cho các luồng AI |
| `backend/markdown_document.py`, `docx_document.py` | Xác thực định dạng, giới hạn và thông báo riêng của từng loại file |
| `backend/document_storage.py` | Revision SHA-256, thay file nguyên tử, cập nhật chỉ mục và khôi phục file khi lỗi |
| `backend/knowledge.py` | Trích nội dung, chunks, chỉ mục tìm kiếm và khóa theo file |

## Các quy tắc cần giữ khi mở rộng

- Mỗi board có một hàng đợi lưu riêng. Patch mới ghi đè giá trị cũ của cùng khóa;
  các khóa khác vẫn được giữ. Dấu xóa phải còn trong patch gửi lên server và được
  loại khỏi layout đang hiển thị. Không cho phản hồi của board cũ ghi vào board mới.
- Danh sách thẻ dùng `Map`/`Set` để tìm vị trí, đường nối, trạng thái gắn chat;
  không quét toàn bộ danh sách cho từng thẻ hoặc từng đường nối.
- Reader nhận các props đơn giản để việc polling tạo object mới hoặc kéo thẻ không
  buộc nội dung tài liệu render lại. PDF nhận board zoom để tăng độ nét; DOCX
  nhận board zoom để đồng bộ độ phóng đại trang trong iframe.
  Không remount reader trừ khi người dùng yêu cầu tải lại.
- Controller reader giữ bản nháp và phát hiện xung đột; giao diện chỉ hiển thị và
  gọi hành động. Trước khi ẩn/chuyển khỏi DOCX phải flush qua `readerDrafts.ts`.
- Sau khi mở Writer, xem trước và chỉnh sửa dùng cùng model/iframe. Preview khóa
  thao tác sửa ở bridge; không dùng `.uno:EditDoc` vì lệnh này có thể tải lại file.
  Export/lệnh tuần tự, mỗi load có ID riêng, draft chỉ nhận phiên bản mới đúng
  generation/revision. Flush chờ Save đang chạy và checkpoint xử lý hết input
  trong toolkit trước khi quyết định cần giữ bản nháp, kể cả khi React chưa
  nhận thông báo thay đổi. Phần nhập sau Save được giữ với revision mới.
- Writer chạy bằng WebAssembly/ZetaJS trong worker, có COOP/COEP cùng origin.
  Iframe bù CSS scale của board, viewport theo kích thước pixel thật; Qt xử lý
  DPR. Worker giữ mức zoom trang ở tỷ lệ tương ứng với board. Toolbar một hàng
  cao 42 px ở zoom 100%, cũng scale theo board để giữ tỷ lệ với card; bố cục của
  các nút không đổi chỉ vì zoom, cuộn ngang khi chiều rộng logic của thẻ thiếu.
  Fit lại khi đổi chiều rộng thẻ;
  coalesce viewport mới nhất, giữ model/caret và không tạo sửa nội dung từ thông
  báo view đến trễ. Fontconfig riêng dùng antialias grayscale để tránh viền màu. Phím nhập
  liên tiếp dùng batch lệnh Writer, giữ thứ tự với toolbar/Save và checkpoint;
  không chờ một lần repaint cho từng ký tự. Bộ gõ dùng textarea thật trong
  iframe để trình duyệt/OS giữ ngữ cảnh, không chặn default của phím chữ. Qt
  trả focus về vùng nhập này thay vì canvas không hỗ trợ nhập văn bản. `input`
  gửi delta Unicode vào cùng hàng đợi; vùng ngữ cảnh tối đa 512 grapheme, reset
  khi đổi vị trí/selection/công cụ. Thay dấu chọn đúng suffix cũ bằng text cursor
  rồi xóa/chèn qua Writer, kể cả NFD/surrogate; không dùng Backspace đơn thuần
  để đếm ký tự tổ hợp. Composition cập nhật trực tiếp, chung một nhóm Undo;
  blur/Save/preview flush trước barrier. Snapshot chờ 3 giây ngừng nhập.
  Mở DOCX không gửi tài liệu đến máy chủ Office hay CDN. Cài engine qua
  `bash scripts/setup.sh --office`; bộ đóng gói cần kèm
  runtime và notice/source của upstream. `PDM_OFFICE_ASSETS` đổi thư mục engine.
- Lưu tài liệu luôn khóa theo thứ tự **file → DB writer**, kiểm tra lại file đã đăng
  ký và revision trong khóa. Giữ metadata nguồn/môn/dự án khi lập chỉ mục lại.
  Không tự tăng revision nghiệp vụ khi chỉ sửa nội dung file.
- Mở board hoặc reader không được tự gọi AI. Gợi ý và gắn thẻ vào chat giữ luồng
  chủ động hiện có của người dùng.
- Sắp xếp chỉ tác động vị trí, góc nhìn và đường nối, dùng cùng hàng đợi lưu riêng
  cho tất cả canvas. Xem trước không PATCH; áp dụng/hoàn tác mới lưu. Không đổi
  kích thước thẻ, nội dung tài liệu, checklist, deadline hay revision nghiệp vụ.
- Codex chỉ nhận ID thẻ từ client; nội dung lấy lại từ board/công việc/tài liệu
  phía server. Kết quả phải chứa đúng các ID, tôn trọng phụ thuộc và mũi tên người
  dùng vẽ, không có đường nối ngược thứ tự. Fingerprint chặn kết quả cũ nếu nội
  dung hoặc bố cục đổi khi suy luận. Mũi tên `arrange:` là đề xuất có thể thay thế;
  đường nối thủ công được giữ. Phần xem trước không remount reader.

## Kiểm tra khi thay đổi

```bash
bash scripts/setup.sh
bash scripts/check.sh
# Cài Writer và Chromium trước khi chạy toàn bộ hành trình:
bash scripts/setup.sh --office
pnpm --dir frontend exec playwright install chromium
bash scripts/check.sh --e2e
```

Unit test frontend dùng Node.js 22 với `--experimental-strip-types`. Playwright tự
khởi động backend 8766, dùng DB/cache tạm, tắt AI và không dùng OAuth cá nhân.
`tests/api_contract.json` giữ method/path trước khi tách router. Endpoint cụ thể
phải đăng ký trước endpoint tổng quát `/{kind}` để tránh bắt nhầm đường dẫn.

Cấu hình được đọc từ `.env` và biến môi trường; import module không tạo thư mục,
token hoặc database. Khởi tạo thực hiện trong lifespan; migrations dùng đường dẫn
package để chạy được từ wheel. Bản wheel chỉ chứa backend; frontend build được
chỉ định qua `PDM_WEB_DIST`. Xem [hướng dẫn phát triển](DEVELOPMENT.md),
[tham chiếu cấu hình](CONFIGURATION.md) và [quy trình phát hành](RELEASING.md).
