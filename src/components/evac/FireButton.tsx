import { useEffect, useState } from 'react';
import { Flame } from 'lucide-react';
import {
  isHotTriggerActive,
  subscribeFireControl,
} from '@/lib/evac/fireControlStore';

export type FireButtonPlacement = 'tab' | 'navbar';

interface FireButtonProps {
  placement: FireButtonPlacement;
  /** Disable the click (e.g. fire already in progress). */
  disabled?: boolean;
  /** Called when the button is clicked. Caller decides whether to
   *  open the confirmation modal or fire immediately based on
   *  placement + current hot-trigger state. */
  onClick: () => void;
}

/**
 * Shared fire button used in two places:
 *
 *   - placement="tab"    → top of ArmedStatePanel. Full-width, prominent.
 *                           Honors hot-trigger visual state (brighter,
 *                           pulsing, label changes to PRIMED — FIRE NOW).
 *   - placement="navbar" → small inline button in the top navbar.
 *                           Always reads as glass (modal-bound) even
 *                           when hot-trigger is on, by deliberate
 *                           design: the navbar is a panic button and
 *                           should not bypass confirmation.
 *
 * Visibility is controlled by the caller (mount/unmount based on
 * armed state). This component does not check armed state itself.
 */
export function FireButton({ placement, disabled, onClick }: FireButtonProps) {
  const [hotActive, setHotActive] = useState<boolean>(isHotTriggerActive());

  useEffect(() => {
    const unsub = subscribeFireControl(() => setHotActive(isHotTriggerActive()));
    return unsub;
  }, []);

  // Navbar variant ignores hot trigger for label/style — always glass.
  const showHot = placement === 'tab' && hotActive;

  if (placement === 'navbar') {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-destructive text-destructive-foreground text-[10px] font-bold uppercase tracking-wider hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
        title="Evacuate wallet"
        aria-label="Evacuate wallet"
      >
        <Flame size={12} />
        Evacuate
      </button>
    );
  }

  // Tab variant
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`w-full px-5 py-4 rounded-md font-bold uppercase tracking-wider text-[13px] transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 ${
        showHot
          ? 'bg-destructive text-destructive-foreground ring-2 ring-destructive ring-offset-2 ring-offset-card animate-pulse shadow-[0_0_40px_-5px_hsl(var(--destructive))]'
          : 'bg-destructive text-destructive-foreground hover:opacity-90'
      }`}
      data-hot={showHot ? 'true' : 'false'}
    >
      <Flame size={16} />
      {showHot ? 'Primed — Fire Now' : 'Evacuate Now'}
    </button>
  );
}
