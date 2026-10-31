import { useState } from 'react'
import {
  ArrowRight,
  CalendarDays,
  Check,
  ExternalLink,
  Laptop,
  Link2,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Upload,
  X,
} from 'lucide-react'
import { api } from '../api'
import { Button } from '../ui'
import { useConnections } from './useConnections'
import './connections.css'

type Props = {
  welcome?: boolean
  onContinue?: () => void
  onChanged?: () => void
  onGoogleSettings?: () => void
}

export function ConnectionsPage({
  welcome = false,
  onContinue,
  onChanged,
  onGoogleSettings,
}: Props) {
  const connection = useConnections(onChanged)
  const { data, error, busy, googleWaiting, refresh, login, cancel, useSystem, disconnect } =
    connection
  const [googleReturn] = useState(() => new URLSearchParams(location.search).get('google'))
  const [confirm, setConfirm] = useState<'codex' | 'google' | null>(null)
  const [configError, setConfigError] = useState(''),
    [uploading, setUploading] = useState(false)
  const codex = data?.codex,
    google = data?.google
  const connected = Number(!!codex?.connected) + Number(!!google?.connected)
  async function configure(file?: File) {
    if (!file) return
    setUploading(true)
    setConfigError('')
    try {
      await api('/google/config', 'POST', JSON.parse(await file.text()))
      await refresh()
    } catch (error: any) {
      setConfigError(error.message)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className={'connections-page' + (welcome ? ' is-welcome' : '')}>
      <header className="connections-intro">
        <div className="connection-eyebrow">
          <Laptop size={14} />
          Không gian trên máy của bạn
        </div>
        <h1 tabIndex={welcome ? -1 : undefined}>
          {welcome ? 'Bắt đầu theo nhịp của bạn.' : 'Kết nối công cụ của bạn.'}
        </h1>
        <p>
          Nhờ Codex hỗ trợ công việc, giữ deadline bên cạnh lịch mỗi ngày. Kết nối từng dịch vụ khi
          bạn cần.
        </p>
        <div className="connections-progress">
          <span>{connected}/2 đã kết nối</span>
          <span>Không bắt buộc</span>
        </div>
      </header>

      {error && (
        <div className="connection-alert" role="alert">
          <p>{error}</p>
          <button className="text-btn" onClick={() => refresh()}>
            Thử lại
          </button>
        </div>
      )}
      {!data && !error && (
        <p className="connection-loading" role="status">
          <LoaderCircle className="spin" size={16} />
          Đang kiểm tra kết nối…
        </p>
      )}

      <div className="connection-cards" aria-busy={!data || !!busy}>
        <section className="connection-card" aria-labelledby="connect-codex-title">
          <div className="connection-card-top">
            <span className="connection-service-icon">
              <Sparkles size={23} />
            </span>
            <span className={'connection-badge' + (codex?.connected ? ' is-connected' : '')}>
              {codex?.pending ? (
                'Chờ đăng nhập'
              ) : codex?.connected ? (
                <>
                  <Check size={12} />
                  Đã kết nối
                </>
              ) : (
                'Chưa kết nối'
              )}
            </span>
          </div>
          <h2 id="connect-codex-title">Codex</h2>
          <p className="connection-description">
            Biến tài liệu và ý tưởng thành những bước dễ bắt đầu.
          </p>
          <div className="connection-account">
            {codex?.connected ? (
              <>
                <b>{codex.account?.email || 'Tài khoản Codex đã đăng nhập'}</b>
                <small>
                  {codex.account?.plan ? codex.account.plan.toUpperCase() + ' · ' : ''}
                  {codex.source === 'system'
                    ? 'Đang dùng phiên trên máy'
                    : 'Đăng nhập riêng cho HBA Studio'}
                </small>
              </>
            ) : (
              <small>Đăng nhập bằng tài khoản ChatGPT của bạn.</small>
            )}
          </div>

          {codex?.error && (
            <p className="connection-inline-error" role="alert">
              {codex.error}
            </p>
          )}
          {codex?.pending ? (
            <div className="connection-pending" role="status">
              <p>Hoàn tất đăng nhập ở trang ChatGPT. HBA Studio sẽ tự cập nhật khi bạn quay lại.</p>
              {codex.pending.code && (
                <div className="connection-device-code">
                  <span>Mã đăng nhập</span>
                  <code>{codex.pending.code}</code>
                  <button
                    className="text-btn"
                    onClick={() =>
                      navigator.clipboard
                        .writeText(codex.pending!.code!)
                        .catch(() =>
                          setConfigError(
                            'Chưa sao chép được mã. Bạn có thể nhập mã đang hiển thị.',
                          ),
                        )
                    }
                  >
                    Sao chép mã
                  </button>
                </div>
              )}
              <a className="btn subtle" href={codex.pending.url} target="_blank" rel="noreferrer">
                Mở trang đăng nhập <ExternalLink size={14} />
              </a>
              <button className="text-btn" disabled={!!busy} onClick={cancel}>
                Hủy đăng nhập
              </button>
            </div>
          ) : (
            <div className="connection-actions">
              <Button
                disabled={!codex?.installed || !codex?.enabled || !!busy}
                onClick={() => login('codex')}
              >
                <Link2 size={15} />
                {busy === 'codex'
                  ? 'Đang mở…'
                  : codex?.connected
                    ? 'Đăng nhập tài khoản khác'
                    : 'Kết nối Codex'}
              </Button>
              {codex?.connected && (
                <button className="text-btn" disabled={!!busy} onClick={() => setConfirm('codex')}>
                  Ngắt kết nối
                </button>
              )}
            </div>
          )}

          {codex && !codex.installed ? (
            <p className="connection-help">
              Máy này chưa có Codex.{' '}
              <a href="https://learn.chatgpt.com/docs/quickstart" target="_blank" rel="noreferrer">
                Xem cách cài đặt <ExternalLink size={12} />
              </a>
            </p>
          ) : codex && !codex.enabled ? (
            <p className="connection-help">AI đang tắt trong phiên ứng dụng này.</p>
          ) : (
            !codex?.pending && (
              <details className="connection-alternatives">
                <summary>Cách kết nối khác</summary>
                <div>
                  <button className="text-btn" disabled={!codex || !!busy} onClick={useSystem}>
                    Dùng Codex đã đăng nhập trên máy
                  </button>
                  <button
                    className="text-btn"
                    disabled={!codex || !!busy}
                    onClick={() => login('codex', 'device')}
                  >
                    Đăng nhập bằng mã
                  </button>
                  <p>
                    Phiên CLI/IDE của bạn được giữ nguyên khi kết nối hoặc ngắt trong HBA Studio.
                  </p>
                </div>
              </details>
            )
          )}
        </section>

        <section className="connection-card" aria-labelledby="connect-google-title">
          <div className="connection-card-top">
            <span className="connection-service-icon">
              <CalendarDays size={23} />
            </span>
            <span className={'connection-badge' + (google?.connected ? ' is-connected' : '')}>
              {googleWaiting ? (
                'Chờ đăng nhập'
              ) : google?.connected ? (
                <>
                  <Check size={12} />
                  Đã kết nối
                </>
              ) : (
                'Chưa kết nối'
              )}
            </span>
          </div>
          <h2 id="connect-google-title">Google Calendar</h2>
          <p className="connection-description">
            Đưa deadline lên lịch và xem thời gian bận của bạn.
          </p>
          <div className="connection-account">
            {google?.connected ? (
              <>
                <b>{google.account_label || 'Đã kết nối với Google'}</b>
                <small>Deadline nằm trong lịch riêng của ứng dụng.</small>
              </>
            ) : (
              <small>Bạn chọn tài khoản và các lịch muốn kết nối.</small>
            )}
          </div>
          <div className="connection-actions">
            <Button subtle disabled={!google?.configured || !!busy} onClick={() => login('google')}>
              <CalendarDays size={15} />
              {busy === 'google'
                ? 'Đang mở…'
                : google?.connected
                  ? 'Đăng nhập lại Google'
                  : 'Kết nối Google Calendar'}
            </Button>
            {google?.connected && (
              <button className="text-btn" disabled={!!busy} onClick={() => setConfirm('google')}>
                Ngắt kết nối
              </button>
            )}
          </div>
          {googleWaiting && (
            <p className="connection-help" role="status">
              Hoàn tất cấp quyền ở trang Google, rồi quay lại đây. Nếu đã đóng trang, bạn có thể kết
              nối lại.
            </p>
          )}
          <details className="connection-alternatives">
            <summary>App được truy cập những gì?</summary>
            <div>
              <p>
                Tạo và cập nhật lịch riêng của ứng dụng. Đọc danh sách lịch và sự kiện trong những
                lịch bạn chọn. Các lịch khác không bị chỉnh sửa.
              </p>
              {google?.connected && onGoogleSettings && (
                <button className="text-btn" onClick={onGoogleSettings}>
                  Chọn lịch & điều chỉnh đồng bộ <ArrowRight size={13} />
                </button>
              )}
            </div>
          </details>
          {google && !google.configured && (
            <details className="connection-config">
              <summary>Kết nối Google chưa được thiết lập cho bản app này</summary>
              <div>
                <p>
                  Người đóng gói ứng dụng cần cung cấp cấu hình Google một lần. Bạn cũng có thể thêm
                  cấu hình Desktop app của riêng mình.
                </p>
                <label className="btn subtle">
                  <Upload size={14} />
                  {uploading ? 'Đang kiểm tra…' : 'Chọn cấu hình Google'}
                  <input
                    hidden
                    type="file"
                    accept=".json"
                    disabled={uploading}
                    onChange={(event) => {
                      void configure(event.target.files?.[0])
                      event.target.value = ''
                    }}
                  />
                </label>
              </div>
            </details>
          )}
        </section>
      </div>

      {googleReturn === 'cancelled' && (
        <p className="connection-help" role="status">
          Bạn đã hủy đăng nhập Google. Bạn có thể kết nối lại bất cứ lúc nào.
        </p>
      )}
      {(googleReturn === 'failed' || googleReturn === 'limited') && (
        <p className="connection-inline-error" role="alert">
          {googleReturn === 'limited'
            ? 'Google Calendar đang giãn lượt gọi. Hãy đợi một lát rồi bấm kết nối lại.'
            : 'Chưa hoàn tất kết nối Google Calendar. Hãy bấm kết nối lại và cấp đủ quyền Calendar. Kết nối trước đó vẫn được giữ nếu có.'}
        </p>
      )}
      {configError && (
        <p className="connection-inline-error" role="alert">
          {configError}
        </p>
      )}
      {confirm && (
        <section
          className="connection-confirm"
          role="alertdialog"
          aria-label={'Ngắt kết nối ' + (confirm === 'codex' ? 'Codex' : 'Google Calendar')}
        >
          <div>
            <h3>Ngắt {confirm === 'codex' ? 'Codex' : 'Google Calendar'} khỏi HBA Studio?</h3>
            <p>
              {confirm === 'codex'
                ? 'Công việc và lịch sử trò chuyện vẫn được giữ. Phiên Codex CLI/IDE không bị đăng xuất.'
                : 'Dừng đồng bộ và gỡ bản lịch ngoài đã nhập trong app. Công việc của bạn và dữ liệu trên Google vẫn được giữ.'}
            </p>
          </div>
          <div className="connection-actions">
            <Button autoFocus subtle disabled={!!busy} onClick={() => setConfirm(null)}>
              Giữ kết nối
            </Button>
            <Button
              danger
              disabled={!!busy}
              onClick={async () => {
                await disconnect(confirm)
                setConfirm(null)
              }}
            >
              Ngắt kết nối
            </Button>
          </div>
        </section>
      )}

      <footer className="connections-footer">
        <p>
          <ShieldCheck size={15} />
          Thông tin đăng nhập được giữ trên máy. HBA Studio không hỏi mật khẩu của bạn.
        </p>
        {onContinue ? (
          <Button onClick={onContinue}>
            {connected ? 'Vào Không gian' : 'Bắt đầu, kết nối sau'}
            <ArrowRight size={16} />
          </Button>
        ) : (
          <button className="text-btn" disabled={!!busy} onClick={() => refresh()}>
            <RefreshCw size={14} />
            Kiểm tra lại kết nối
          </button>
        )}
      </footer>
    </div>
  )
}
