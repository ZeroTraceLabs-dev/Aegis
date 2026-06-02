/**
 * Fire-control store — a small module-level state machine that bridges
 * the navbar Fire button (in Index.tsx) to the ArmedStatePanel (deep
 * inside DashboardContent → EvacSetupFlow). Two responsibilities:
 *
 *   1. Hot-trigger toggle state, with auto-expire timestamp. The
 *      countdown UI computes remaining seconds from expiresAt; the
 *      tab toggle component is responsible for setting an interval to
 *      re-render that.
 *
 *   2. A "request fire modal" signal seq number. The navbar button
 *      increments it; ArmedStatePanel watches for changes and opens
 *      the confirmation modal. Sequence number (not boolean) so each
 *      navbar click reliably re-fires even if the modal was just
 *      dismissed.
 *
 * Mirrors the subscribe/notify pattern from spamFilterStore.
 */

const HOT_TRIGGER_DURATION_MS = 60_000;

interface FireControlState {
  hotTriggerActive: boolean;
  hotTriggerExpiresAt: number | null;
  modalRequestSeq: number;
}

let state: FireControlState = {
  hotTriggerActive: false,
  hotTriggerExpiresAt: null,
  modalRequestSeq: 0,
};

const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((fn) => fn());
}

export function subscribeFireControl(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function getFireControlState(): FireControlState {
  // Lazy-expire on read so callers don't have to poll for expiration.
  if (state.hotTriggerActive && state.hotTriggerExpiresAt !== null && Date.now() > state.hotTriggerExpiresAt) {
    state = { ...state, hotTriggerActive: false, hotTriggerExpiresAt: null };
    notify();
  }
  return state;
}

export function activateHotTrigger(durationMs: number = HOT_TRIGGER_DURATION_MS): void {
  state = {
    ...state,
    hotTriggerActive: true,
    hotTriggerExpiresAt: Date.now() + durationMs,
  };
  notify();
}

export function deactivateHotTrigger(): void {
  state = {
    ...state,
    hotTriggerActive: false,
    hotTriggerExpiresAt: null,
  };
  notify();
}

export function isHotTriggerActive(): boolean {
  return getFireControlState().hotTriggerActive;
}

export function getHotTriggerRemainingMs(): number {
  const s = getFireControlState();
  if (!s.hotTriggerActive || s.hotTriggerExpiresAt === null) return 0;
  return Math.max(0, s.hotTriggerExpiresAt - Date.now());
}

/** Bumped by the navbar fire button to ask the ArmedStatePanel to
 *  open its confirmation modal. The navbar also separately requests a
 *  tab switch to 'emergency' so the panel is mounted in time. */
export function requestFireModal(): void {
  state = { ...state, modalRequestSeq: state.modalRequestSeq + 1 };
  notify();
}

export const HOT_TRIGGER_DEFAULT_MS = HOT_TRIGGER_DURATION_MS;
