import type { SVGProps } from 'react'

export function SignalChaseMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <rect x="1" y="1" width="46" height="46" rx="8" fill="#181B19" />
      <circle cx="24" cy="24" r="15" stroke="#527665" strokeWidth="2" />
      <circle cx="24" cy="24" r="8" stroke="#A5C7AC" strokeWidth="2" />
      <path d="M24 24 36 12" stroke="#E9A14B" strokeWidth="3" strokeLinecap="round" />
      <circle cx="24" cy="24" r="3" fill="#E9DFC5" />
    </svg>
  )
}
