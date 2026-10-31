"""Small reproducible Vietnamese retrieval fixture; not a claim about every corpus."""

import os
import tempfile
from pathlib import Path

FIXTURES = [
    (
        "xv6",
        "Hệ điều hành xv6: system call đi qua trap và syscall dispatch; kernel sao chép tham số từ user space.",
        "Luồng lời gọi hệ thống đi vào nhân như thế nào?",
    ),
    (
        "bloxorz",
        "Đồ án Bloxorz biểu diễn trạng thái khối hộp và tìm đường bằng BFS, UCS, A* với heuristic.",
        "Bloxorz cần thuật toán tìm kiếm đường đi nào?",
    ),
    (
        "android",
        "Android khai báo Activity launcher trong AndroidManifest với MAIN và LAUNCHER để mở ứng dụng.",
        "Ứng dụng Android cần khai báo gì để khởi chạy?",
    ),
    (
        "database",
        "Database dùng khóa ngoại để bảo vệ quan hệ, transaction rollback đảm bảo tính nguyên tử của dữ liệu.",
        "Làm sao bảo vệ toàn vẹn cơ sở dữ liệu khi giao dịch lỗi?",
    ),
    (
        "networks",
        "Mạng máy tính TCP thiết lập kết nối ba bước SYN SYN-ACK ACK và truyền dữ liệu đáng tin cậy.",
        "TCP bắt tay thiết lập kết nối qua những bước nào?",
    ),
    (
        "linear",
        "Đại số tuyến tính nghiên cứu vector, ma trận, trị riêng và phép biến đổi tuyến tính.",
        "Môn nào dạy trị riêng của ma trận?",
    ),
    (
        "probability",
        "Xác suất thống kê dùng định lý Bayes để cập nhật xác suất hậu nghiệm từ dữ liệu quan sát.",
        "Cập nhật xác suất hậu nghiệm bằng công thức nào?",
    ),
    (
        "writing",
        "Báo cáo đồ án gồm giới thiệu, phương pháp, thực nghiệm, kết quả và tài liệu tham khảo; hạn nộp ngày 30 tháng 11.",
        "Cấu trúc và hạn nộp báo cáo đồ án là gì?",
    ),
    (
        "presentation",
        "Thuyết trình nhóm cần phân chia người nói, chuẩn bị slide, luyện tập và dành thời gian trả lời câu hỏi.",
        "Nhóm cần chuẩn bị gì trước buổi thuyết trình?",
    ),
    (
        "git",
        "Git quản lý phiên bản bằng commit và branch; cần giải quyết conflict trước khi merge nhánh.",
        "Khi gộp nhánh Git gặp xung đột phải làm gì?",
    ),
    (
        "rag",
        "RAG chia tài liệu thành đoạn, tạo embedding, truy xuất ngữ cảnh và sinh câu trả lời có dẫn nguồn.",
        "Hỏi đáp tài liệu có dẫn chứng cần quy trình truy xuất nào?",
    ),
    (
        "schedule",
        "Lập lịch công việc phải tính giờ rảnh, deadline, thời lượng và các bước phụ thuộc; giữ buổi đã khóa.",
        "Làm sao xếp công việc theo thời gian rảnh và hạn nộp?",
    ),
    (
        "backup",
        "Sao lưu SQLite bằng backup API tạo snapshot nhất quán; phục hồi vào thư mục trống rồi kiểm tra integrity.",
        "Phục hồi bản sao database cần kiểm tra điều gì?",
    ),
    (
        "security",
        "Bảo mật ứng dụng local cần kiểm tra Origin, giới hạn loopback và không đưa token đăng nhập vào log.",
        "Làm sao bảo vệ token và API chạy tại máy?",
    ),
    (
        "os-memory",
        "Bộ nhớ ảo ánh xạ địa chỉ qua page table; page fault xảy ra khi trang chưa có mapping hợp lệ.",
        "Page fault liên quan đến bảng trang và ánh xạ địa chỉ thế nào?",
    ),
    (
        "algorithms",
        "Thuật toán sắp xếp merge sort chia để trị, có độ phức tạp O(n log n) và cần bộ nhớ phụ.",
        "Độ phức tạp của thuật toán trộn là bao nhiêu?",
    ),
    (
        "english",
        "Kế hoạch học tiếng Anh gồm luyện nghe hằng ngày, học từ vựng theo ngữ cảnh và luyện phát âm.",
        "Tự học ngoại ngữ cần luyện nghe và từ vựng ra sao?",
    ),
    (
        "exam",
        "Ôn thi cuối kỳ cần đọc đề cương, hệ thống kiến thức, làm đề thử và nghỉ ngơi trước ngày thi.",
        "Trước kỳ thi cuối kỳ nên chuẩn bị những gì?",
    ),
    (
        "graph",
        "Đồ thị có hướng không chu trình hỗ trợ topological sort để sắp thứ tự công việc phụ thuộc.",
        "Sắp thứ tự topo áp dụng cho loại đồ thị nào?",
    ),
    (
        "testing",
        "Kiểm thử phần mềm gồm unit test, integration test và end-to-end; Playwright kiểm chứng thao tác trên trình duyệt.",
        "Công cụ nào kiểm thử luồng người dùng trong trình duyệt?",
    ),
]


def main():
    with tempfile.TemporaryDirectory(prefix="pdm-retrieval-") as directory:
        os.environ["PDM_DATA_DIR"] = directory + "/data"
        from backend.db import initialize
        from backend import knowledge

        initialize()
        if not knowledge.model_ready():
            raise RuntimeError("Download embedding model in settings first")
        for name, content, _ in FIXTURES:
            file = Path(directory) / (name + ".md")
            file.write_text(content)
            knowledge.ingest(file)
        knowledge.index_embeddings()
        found = 0
        hybrid = 0
        for name, _, query in FIXTURES:
            result = knowledge.search(query, limit=5)
            ok = any(hit["title"] == name + ".md" for hit in result["hits"])
            found += ok
            hybrid += result["mode"] == "hybrid"
            print(("PASS" if ok else "MISS") + " " + name, flush=True)
        print(f"Recall@5: {found}/{len(FIXTURES)}; hybrid queries: {hybrid}/{len(FIXTURES)}")
        knowledge.shutdown()
        if found < 16:
            raise SystemExit(1)


if __name__ == "__main__":
    main()
