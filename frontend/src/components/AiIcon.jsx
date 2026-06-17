// Custom AI Assistant mark — a chat bubble with a rising trend line.
// Inherits color via currentColor so it works on gradient avatars and in the nav.
export default function AiIcon({ size = '1em' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" width={size} height={size}
         xmlns="http://www.w3.org/2000/svg" aria-hidden="true"
         style={{ display: 'inline-block', verticalAlign: 'middle' }}>
      <path d="M4 6a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3H9.5L5 20.5V16a3 3 0 0 1-1-2.2V6Z"
            stroke="currentColor" strokeWidth="1.7"
            strokeLinejoin="round" strokeLinecap="round" />
      <path d="M7.8 12.2l2.5-2.6 2.1 1.8 3.6-3.5"
            stroke="currentColor" strokeWidth="1.7"
            strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
