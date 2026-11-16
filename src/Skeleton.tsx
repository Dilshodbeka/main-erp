import type { ReactNode } from 'react';

export function skeletonRows(count: number): null[] {
  return Array.from({ length: count }, () => null);
}

export function Skeleton({ rows = 4, className = '' }: { rows?: number; className?: string }): ReactNode {
  return (
    <div className={`skeleton ${className}`} aria-hidden="true">
      {skeletonRows(rows).map((_, i) => <div className="skeleton-row" key={i} />)}
    </div>
  );
}
