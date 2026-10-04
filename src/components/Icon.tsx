import type { IconProps } from './types'

const paths = {
  chat: 'M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6 3V6a2 2 0 0 1 2-2Z',
  send: 'm3 3 19 9-19 9 4-9-4-9Zm4 9h15',
  back: 'm14 6-6 6 6 6M8 12h13',
  logout: 'M10 4H4v16h6m5-13 5 5-5 5m-6-5h11',
  plus: 'M12 5v14M5 12h14',
}
export default function Icon({ name, size = 22 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  )
}
