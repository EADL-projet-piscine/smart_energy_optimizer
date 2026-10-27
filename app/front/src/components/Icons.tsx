type Props = { className?: string }

export function IconBolt({ className }: Props) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M13.6 1.8 4.2 13.6h5.4l-1.2 8.6 10.2-13.1H13l.6-7.3z" />
    </svg>
  )
}

export function IconUsers({ className }: Props) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        d="M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20a6.5 6.5 0 0 1 13 0M16 4.3a3.5 3.5 0 0 1 0 6.4M18 14.2a6.5 6.5 0 0 1 3.5 5.8"
      />
    </svg>
  )
}

export function IconLogout({ className }: Props) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M9 16l-4-4 4-4M5 12h11"
      />
    </svg>
  )
}

export function IconSun({ className }: Props) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        d="M12 3v1.8M12 19.2V21M4.9 4.9l1.3 1.3M17.8 17.8l1.3 1.3M3 12h1.8M19.2 12H21M4.9 19.1l1.3-1.3M17.8 6.2l1.3-1.3"
      />
    </svg>
  )
}

export function IconMoon({ className }: Props) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
        d="M15.5 3.4a8.2 8.2 0 1 0 5.1 12.8A7 7 0 0 1 15.5 3.4z"
      />
    </svg>
  )
}

export function IconWarning({ className }: Props) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 3.2 2.8 19.4a1.4 1.4 0 0 0 1.2 2.1h16a1.4 1.4 0 0 0 1.2-2.1L12 3.2zm0 5.2a1 1 0 0 1 1 1.1l-.4 5.1a.6.6 0 0 1-1.2 0L11 9.5a1 1 0 0 1 1-1.1zm0 10.1a1.15 1.15 0 1 1 0-2.3 1.15 1.15 0 0 1 0 2.3z"
      />
    </svg>
  )
}

export function IconClose({ className }: Props) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        d="M7 7l10 10M17 7 7 17"
      />
    </svg>
  )
}
