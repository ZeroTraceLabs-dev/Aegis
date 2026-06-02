import { useEffect, useState } from 'react';
import { Switch } from '@/components/ui/switch';
import {
  activateHotTrigger,
  deactivateHotTrigger,
  getHotTriggerRemainingMs,
  isHotTriggerActive,
  subscribeFireControl,
  HOT_TRIGGER_DEFAULT_MS,
} from '@/lib/evac/fireControlStore';

/**
 * Hot Trigger toggle — when on, the tab's Evacuate button bypasses the
 * confirmation modal and fires immediately for the next 60 seconds.
 *
 * Only rendered in the Evacuation tab. The navbar Fire button does NOT
 * respect hot trigger — it always opens the confirmation modal first,
 * by design (the navbar is a panic button, not a high-trust surface).
 *
 * Re-renders every 500ms while active so the countdown updates.
 */
export function HotTriggerToggle() {
  const [active, setActive] = useState<boolean>(isHotTriggerActive());
  const [remainingMs, setRemainingMs] = useState<number>(getHotTriggerRemainingMs());

  // Subscribe to store changes (manual toggle, expiry from elsewhere)
  useEffect(() => {
    const unsub = subscribeFireControl(() => {
      setActive(isHotTriggerActive());
      setRemainingMs(getHotTriggerRemainingMs());
    });
    return unsub;
  }, []);

  // Tick the countdown while active.
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => {
      const ms = getHotTriggerRemainingMs();
      setRemainingMs(ms);
      if (ms <= 0) setActive(false);
    }, 250);
    return () => clearInterval(id);
  }, [active]);

  const handleToggle = (checked: boolean) => {
    if (checked) activateHotTrigger();
    else deactivateHotTrigger();
  };

  const seconds = Math.ceil(remainingMs / 1000);

  return (
    <div
      className={`flex items-center justify-between gap-3 p-3 rounded-md border transition-colors ${
        active
          ? 'border-destructive/60 bg-destructive/10'
          : 'border-border bg-background'
      }`}
    >
      <div className="flex-1 min-w-0">
        <label
          htmlFor="hot-trigger-toggle"
          className="text-[11px] font-semibold text-foreground cursor-pointer"
        >
          Hot Trigger — 60s bypass
        </label>
        <p className="text-[10px] text-muted-foreground mt-0.5 leading-relaxed">
          {active
            ? `Hot trigger active — ${seconds}s remaining. Next tap on Evacuate fires immediately, no confirmation.`
            : 'Off: Evacuate opens a confirmation modal. On: next 60 seconds, Evacuate fires immediately.'}
        </p>
      </div>
      <Switch
        id="hot-trigger-toggle"
        checked={active}
        onCheckedChange={handleToggle}
        aria-label={active ? 'Disable hot trigger' : 'Enable hot trigger'}
      />
      {/* The default duration export is referenced here so any future
          tweaks to the duration default propagate through. */}
      <span data-default-ms={HOT_TRIGGER_DEFAULT_MS} className="hidden" aria-hidden="true" />
    </div>
  );
}
