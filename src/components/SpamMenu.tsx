import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
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
 *
 * The dropdown is portaled to document.body so an ancestor with
 * `overflow-hidden` (e.g. the NFT collection card, which needs that to clip
 * its rounded-border children) can't visually clip the popover. The trigger
 * stops propagation so clicks don't fall through to the row's collapse
 * toggle or to the token row's <a> wrapper.
 */
export function SpamMenu({ isSpam, onMark, onUnmark }: SpamMenuProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Click-outside: close if the mousedown lands outside BOTH the trigger
  // and the portaled dropdown.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t)) return;
      if (dropdownRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Reposition the dropdown when the page scrolls or resizes while open.
  useEffect(() => {
    if (!open) return;
    const updatePos = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (rect) {
        setPos({
          top: rect.bottom + 4,
          right: Math.max(8, window.innerWidth - rect.right),
        });
      }
    };
    updatePos();
    window.addEventListener('scroll', updatePos, true);
    window.addEventListener('resize', updatePos);
    return () => {
      window.removeEventListener('scroll', updatePos, true);
      window.removeEventListener('resize', updatePos);
    };
  }, [open]);

  const handleTriggerClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      setPos({
        top: rect.bottom + 4,
        right: Math.max(8, window.innerWidth - rect.right),
      });
    }
    setOpen((o) => !o);
  };

  const handleAction = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (isSpam) onUnmark();
    else onMark();
    setOpen(false);
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={handleTriggerClick}
        className="shrink-0 p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
        aria-label="Item options"
        title="Options"
      >
        <MoreVertical size={14} />
      </button>
      {open && pos && createPortal(
        <div
          ref={dropdownRef}
          style={{ position: 'fixed', top: pos.top, right: pos.right, minWidth: 140 }}
          className="z-[60] bg-card border border-border rounded-md py-1"
        >
          <button
            type="button"
            onClick={handleAction}
            className="w-full text-left px-3 py-1.5 text-[11px] hover:bg-secondary text-foreground transition-colors"
          >
            {isSpam ? 'Unmark as spam' : 'Mark as spam'}
          </button>
        </div>,
        document.body,
      )}
    </>
  );
}
