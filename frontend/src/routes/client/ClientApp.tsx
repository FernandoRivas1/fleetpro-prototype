import { StationPairingProvider, useStationPairing } from '../../pairing/StationPairingContext';
import { LanguageProvider } from './LanguageContext';
import { PinEntry } from './PinEntry';
import { ClientShell } from './ClientShell';

function ClientRoot() {
  const pairing = useStationPairing();
  if (pairing.status === 'not_paired') return <PinEntry />;
  if (pairing.status === 'checking') {
    return <div style={{ padding: 40, color: 'var(--fp-secondary)' }}>Loading…</div>;
  }
  return <ClientShell />;
}

export function ClientApp() {
  return (
    <StationPairingProvider deviceRole="tablet">
      <LanguageProvider>
        <ClientRoot />
      </LanguageProvider>
    </StationPairingProvider>
  );
}
