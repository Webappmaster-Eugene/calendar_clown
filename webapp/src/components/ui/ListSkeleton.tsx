/** List-shaped loading placeholder — richer than a bare "Загрузка…" text.
 *  Reuses the shared `.skeleton` shimmer so it adapts to the Telegram theme. */
export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="list" aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="list-item">
          <span className="skeleton skeleton-avatar" />
          <div className="list-item-content" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span className="skeleton skeleton-line" style={{ width: `${55 + (i % 3) * 12}%` }} />
            <span className="skeleton skeleton-line-short" />
          </div>
        </div>
      ))}
    </div>
  );
}
