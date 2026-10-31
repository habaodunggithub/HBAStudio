import { Leaf } from 'lucide-react'

export function Button({
  children,
  onClick,
  subtle = false,
  danger = false,
  disabled = false,
  type = 'button',
  ...props
}: any) {
  return (
    <button
      type={type}
      disabled={disabled}
      className={`btn ${subtle ? 'subtle' : ''} ${danger ? 'danger' : ''}`}
      onClick={onClick}
      {...props}
    >
      {children}
    </button>
  )
}

export function Empty({ icon: Icon = Leaf, title, children, action }: any) {
  return (
    <div className="empty">
      <Icon size={23} />
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  )
}

export function Field({ label, children, wide = false }: any) {
  return (
    <label className={'field ' + (wide ? 'wide' : '')}>
      <span>{label}</span>
      {children}
    </label>
  )
}
