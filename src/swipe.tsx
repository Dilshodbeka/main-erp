import { useRef, useState, type PointerEvent, type ReactNode } from 'react';

export function swipeDecision(deltaX: number, threshold = 60): 'none' | 'reveal' {
  return deltaX <= -threshold ? 'reveal' : 'none';
}

export interface SwipeAction { label: string; onSelect: () => void; }

const REVEAL = -96;

export function Swipeable({ actions, children }: { actions: SwipeAction[]; children: ReactNode }): ReactNode {
  const [offset, setOffset] = useState(0);
  const start = useRef<number | null>(null);
  const onDown = (e: PointerEvent<HTMLDivElement>) => { if (e.pointerType !== 'touch') return; start.current = e.clientX; };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (start.current === null) return;
    const delta = Math.min(0, e.clientX - start.current);
    setOffset(swipeDecision(delta) === 'reveal' ? REVEAL : delta);
  };
  const onUp = () => { start.current = null; setOffset(swipeDecision(offset) === 'reveal' ? REVEAL : 0); };
  return (
    <div className="swipeable" style={{ transform: `translateX(${offset}px)`, transition: 'transform .18s ease' }}
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
      <div className="swipe-actions" aria-hidden={offset === 0}>
        {actions.map(a => <button key={a.label} type="button" className="swipe-action" onClick={a.onSelect}>{a.label}</button>)}
      </div>
      <div className="swipe-content">{children}</div>
    </div>
  );
}
