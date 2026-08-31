import { useStationPairing } from '../../pairing/StationPairingContext';

/** Design file: Tablet Shell States.dc.html (4b) — the resting state
 * between customers, all day. */
export function IdleScreen({ stationLabel }: { stationLabel: string }) {
  const pairing = useStationPairing();
  const linked = pairing.status === 'open';

  return (
    <div
      style={{
        height: '100vh',
        width: '100vw',
        background: '#fff',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
      }}
    >
      <div style={{ position: 'absolute', bottom: 30, left: 40, fontFamily: 'var(--fp-font-mono)', fontSize: 12, letterSpacing: '0.12em', color: '#c3ccd4' }}>
        {stationLabel}
      </div>
      <div
        style={{
          position: 'absolute',
          bottom: 30,
          right: 40,
          display: 'flex',
          alignItems: 'center',
          gap: 9,
          fontFamily: 'var(--fp-font-mono)',
          fontSize: 12,
          letterSpacing: '0.12em',
          color: '#c3ccd4',
        }}
      >
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: linked ? 'var(--fp-status-available)' : '#c3ccd4' }} />
        {linked ? 'LINKED' : 'RECONNECTING'}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 34 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: 16,
              background: 'var(--fp-primary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              fontWeight: 700,
              fontSize: 30,
            }}
          >
            F
          </div>
          <div style={{ fontSize: 56, fontWeight: 700, letterSpacing: '-0.035em', color: 'var(--fp-primary)' }}>Fleetpro</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div
            style={{
              width: 12,
              height: 12,
              borderRadius: '50%',
              background: 'var(--fp-accent)',
              animation: 'fp-breathe 2.6s ease-in-out infinite',
            }}
          />
          <div style={{ fontSize: 24, color: 'var(--fp-text-muted)', letterSpacing: '-0.01em' }}>
            Waiting for the next customer…
          </div>
        </div>
      </div>
      <style>{`@keyframes fp-breathe { 0%,100% { opacity: .3; transform: scale(1) } 50% { opacity: .85; transform: scale(1.06) } }`}</style>
    </div>
  );
}
