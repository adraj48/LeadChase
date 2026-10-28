// Tiny rounded-square mark drawn from simple shapes (original, not a real logo).
export function BrandMark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="shrink-0">
      <rect width="24" height="24" rx="7" fill="#0070ff" />
      <path d="M7 16.5 12 7l5 9.5" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="12" cy="16.5" r="1.4" fill="#fff" />
    </svg>
  );
}
