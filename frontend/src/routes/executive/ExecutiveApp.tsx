import { StationPairingProvider, useStationPairing } from '../../pairing/StationPairingContext';
import { StationSetup } from './StationSetup';
import { ExecutiveShell } from './ExecutiveShell';

function ExecutiveRoot() {
  const pairing = useStationPairing();
  if (pairing.status === 'not_paired') return <StationSetup />;
  if (pairing.status === 'checking') return <div className="centered-empty">Loading…</div>;
  return <ExecutiveShell />;
}

export function ExecutiveApp() {
  return (
    <StationPairingProvider deviceRole="executive">
      <ExecutiveRoot />
    </StationPairingProvider>
  );
}
