export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden="true" className={className}>
      <path
        d="M9 4h10l6 6v16a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"
        stroke="currentColor"
        strokeOpacity="0.55"
        strokeWidth="1.5"
      />
      <path d="M19 4v6h6" stroke="currentColor" strokeOpacity="0.55" strokeWidth="1.5" />
      <path
        d="m11.5 17.5 3 3 6-7"
        stroke="var(--primary)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
