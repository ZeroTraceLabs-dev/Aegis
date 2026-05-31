import { useState, useRef, useEffect } from 'react';
import { MoreVertical } from 'lucide-react';

interface SpamMenuProps {
  isSpam: boolean;
  onMark: () => void;
  onUnmark: () => void;
}

/**
 * Small three-dot overflow menu used on token rows and NFT collection rows.
 *
 * - Click the dots → menu opens with a single "Mark as spam" / "Unmark as
 *   spam" action (no confirmation, instant).
 * - Click outside → menu closes.
 * - stopPropagation + preventDefault on the button so the menu doesn't
 *   trigger row navigation (the token row is an <a>, the NFT collection
 *   row is a collapse <button>).
 */
export function SpamMenu({ isSpam, onMark, onUnmark }: SpamMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleAction = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (isSpam) onUnmark();
    else onMark();
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); e.preventDefault(); setOpen((o) => !o); }}
        className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
        aria-label="Item options"
        title="Options"
      >
        <MoreVertical size={14} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 bg-card border border-border rounded-md min-w-[140px] py-1">
          <button
            type="button"
            onClick={handleAction}
            className="w-full text-left px-3 py-1.5 text-[11px] hover:bg-secondary text-foreground transition-colors"
          >
            {isSpam ? 'Unmark as spam' : 'Mark as spam'}
          </button>
        </div>
      )}
    </div>
  );
}
