import { useEffect, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import {
  initEvacConfigForWallet,
  clearEvacConfig,
  subscribeEvacConfig,
  getEvacStep,
} from '@/lib/evac/configStore';
import type { WalletData } from '@/hooks/useWalletScan';
import type { TokenMeta } from '@/hooks/useAssetMetadata';
import { Step1ThreatModel } from './Step1ThreatModel';
import { Step2GasWallet } from './Step2GasWallet';
import { Step3Destination } from './Step3Destination';
import { Step4Priorities } from './Step4Priorities';
import { Step5ALTPublish } from './Step5ALTPublish';
import { ArmedStatePanel } from './ArmedStatePanel';

interface EvacSetupFlowProps {
  wallet: WalletData;
  metadata: Map<string, TokenMeta>;
}

/**
 * Container for the five-step evac setup flow. Reads the current step
 * from the config store (which is derived from persisted state) and
 * renders the matching component. Subscribes to store changes so step
 * completion advances the flow immediately.
 *
 * Once all four pieces are in place (gas wallet, destination, priority,
 * ALT) the flow swaps to the ArmedStatePanel summary instead.
 *
 * This is the sole surface in the Evacuation tab. The legacy
 * NuclearEvacuation component has been removed; the fire path will be
 * wired into ArmedStatePanel in the next brief.
 */
export function EvacSetupFlow({ wallet, metadata }: EvacSetupFlowProps) {
  const { publicKey } = useWallet();
  const [, forceUpdate] = useState(0);

  // Init / clear store on wallet change.
  useEffect(() => {
    if (publicKey) initEvacConfigForWallet(publicKey.toBase58());
    else clearEvacConfig();
  }, [publicKey]);

  // Re-render on any config-store mutation.
  useEffect(() => {
    const unsub = subscribeEvacConfig(() => forceUpdate((n) => n + 1));
    return unsub;
  }, []);

  if (!publicKey) {
    return (
      <div className="bg-card border border-border rounded-md p-5 card-glow">
        <h3 className="section-header text-sm font-semibold text-foreground uppercase tracking-wider mb-3">
          Evacuation Setup
        </h3>
        <p className="text-xs text-muted-foreground">
          Connect a wallet to begin evac setup.
        </p>
      </div>
    );
  }

  // forceUpdate is read as a state-trigger; re-derive step every render.
  const currentStep = getEvacStep();

  return (
    <div className="bg-card border border-border rounded-md p-5 card-glow">
      <StepHeader step={currentStep} />

      <div className="mt-4">
        {currentStep === 1 && <Step1ThreatModel />}
        {currentStep === 2 && <Step2GasWallet wallet={wallet} />}
        {currentStep === 3 && <Step3Destination />}
        {currentStep === 4 && <Step4Priorities wallet={wallet} metadata={metadata} />}
        {currentStep === 5 && <Step5ALTPublish wallet={wallet} />}
        {currentStep === 'armed' && (
          <ArmedStatePanel wallet={wallet} metadata={metadata} />
        )}
      </div>
    </div>
  );
}

function StepHeader({ step }: { step: 1 | 2 | 3 | 4 | 5 | 'armed' }) {
  if (step === 'armed') {
    return (
      <div className="flex items-center justify-between">
        <h3 className="section-header text-sm font-semibold text-foreground uppercase tracking-wider">
          Evac · Armed
        </h3>
        <span className="text-[10px] font-medium text-primary uppercase tracking-wider">
          Ready
        </span>
      </div>
    );
  }

  const STEPS: { n: number; label: string }[] = [
    { n: 1, label: 'Threat' },
    { n: 2, label: 'Gas' },
    { n: 3, label: 'Destination' },
    { n: 4, label: 'Priority' },
    { n: 5, label: 'Arm' },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="section-header text-sm font-semibold text-foreground uppercase tracking-wider">
          Evacuation Setup
        </h3>
        <span className="text-[10px] text-muted-foreground">
          Step {step} of 5
        </span>
      </div>
      <div className="flex items-center gap-1">
        {STEPS.map((s) => {
          const done = s.n < step;
          const active = s.n === step;
          return (
            <div key={s.n} className="flex-1 flex flex-col items-center gap-1">
              <div
                className={`h-1 w-full rounded-full ${
                  done ? 'bg-primary' : active ? 'bg-primary/60' : 'bg-border'
                }`}
              />
              <span
                className={`text-[9px] uppercase tracking-wider ${
                  done || active ? 'text-foreground' : 'text-muted-foreground/60'
                }`}
              >
                {s.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
