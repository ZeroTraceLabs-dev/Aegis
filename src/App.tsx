import React, { useMemo } from 'react';
import { Routes, Route } from 'react-router-dom';
import { Toaster } from '@/components/ui/toaster';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { RPC_ENDPOINT } from '@/lib/rpc';
import NotFound from './pages/NotFound';
import Index from './pages/Index';

import '@solana/wallet-adapter-react-ui/styles.css';

const App = () => {
  const wallets = useMemo(() => [], []);

  return (
    <ConnectionProvider
      endpoint={RPC_ENDPOINT}
      config={{
        commitment: 'confirmed',
        disableRetryOnRateLimit: true,
      }}
    >
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
          <Toaster />
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
};

export default App;