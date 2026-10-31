import { useEffect, useState } from 'react'
import { Moon, Sun, Monitor } from 'lucide-react'

export type ThemeMode = 'light' | 'dark' | 'system'

export function useTheme() {
  const [mode, setMode] = useState<ThemeMode>(() => {
    try {
      const saved = localStorage.getItem('pdm-theme')
      return saved === 'light' || saved === 'dark' ? saved : 'system'
    } catch {
      return 'system'
    }
  })
  const [systemDark, setSystemDark] = useState(
    () => matchMedia('(prefers-color-scheme: dark)').matches,
  )
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)')
    const changed = () => setSystemDark(media.matches)
    media.addEventListener('change', changed)
    return () => media.removeEventListener('change', changed)
  }, [])
  const dark = mode === 'dark' || (mode === 'system' && systemDark)
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', dark ? '#0b0b0b' : '#e9edf2')
    try {
      localStorage.setItem('pdm-theme', mode)
    } catch {
      /* A private session may disable storage. */
    }
  }, [mode, dark])
  return { mode, setMode, dark }
}

export function ThemeToggle({ dark, onToggle }: { dark: boolean; onToggle: () => void }) {
  const label = dark ? 'Chuyển sang giao diện sáng' : 'Chuyển sang giao diện tối'
  return (
    <button className="icon-btn theme-toggle" aria-label={label} title={label} onClick={onToggle}>
      {dark ? <Sun size={19} /> : <Moon size={19} />}
    </button>
  )
}

export function ThemeOptions({
  mode,
  onChange,
}: {
  mode: ThemeMode
  onChange: (mode: ThemeMode) => void
}) {
  return (
    <div className="theme-options" role="radiogroup" aria-label="Chế độ giao diện">
      {(
        [
          { value: 'light', label: 'Sáng', Icon: Sun },
          { value: 'dark', label: 'Tối', Icon: Moon },
          { value: 'system', label: 'Theo hệ thống', Icon: Monitor },
        ] as const
      ).map(({ value, label, Icon }) => (
        <label className={'theme-option ' + (mode === value ? 'selected' : '')} key={value}>
          <input
            type="radio"
            name="theme"
            value={value}
            checked={mode === value}
            onChange={() => onChange(value)}
          />
          <Icon size={23} />
          <span>{label}</span>
        </label>
      ))}
    </div>
  )
}
