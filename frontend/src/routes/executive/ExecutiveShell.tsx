import { useEffect, useState } from 'react';
import { useStationPairing } from '../../pairing/StationPairingContext';
import { getStation, listBranches, type BranchRead } from '../../lib/api';
import { SearchAndWalkIn } from './SearchAndWalkIn';
import { ActiveSessionPanel } from './ActiveSessionPanel';
import './executive.css';

const NAV_ITEMS = ['Counter', 'Contracts', 'Fleet', 'Drivers', 'Station', 'Reports'];

/** The app chrome (Fleetpro Shells design, 1b) wrapping the search/walk-in
 * screen or the active session panel. Only "Counter" is wired — the rest
 * of the sidebar is out of scope (see main.py's own "wired in as they're
 * implemented" note for the domains behind them). */
export function ExecutiveShell() {
  const pairing = useStationPairing();
  const [branchId, setBranchId] = useState<string | null>(null);
  const [branches, setBranches] = useState<BranchRead[]>([]);
  const [activeContractId, setActiveContractId] = useState<string | null>(null);
  const [resuming, setResuming] = useState(true);

  const stationId = pairing.stationId;

  // Resume-on-reload: Station.active_contract_id is kept current server-side
  // (see ws.py's _update_active_contract) whenever contract_started fires,
  // so a reloaded executive tab lands back in the session instead of search.
  useEffect(() => {
    if (!stationId) return;
    let cancelled = false;
    Promise.all([getStation(stationId), listBranches()])
      .then(([station, branchList]) => {
        if (cancelled) return;
        setBranchId(station.branch_id);
        setBranches(branchList);
        if (station.active_contract_id) setActiveContractId(station.active_contract_id);
      })
      .catch((err) => console.error('Failed to load station/branches', err))
      .finally(() => {
        if (!cancelled) setResuming(false);
      });
    return () => {
      cancelled = true;
    };
  }, [stationId]);

  const branchName = branches.find((b) => b.id === branchId)?.name ?? '';
  const linked = pairing.status === 'open';

  return (
    <div className="exec-page">
      <div className="exec-shell">
        <aside className="exec-sidebar">
          <div className="exec-sidebar__logo">F</div>
          <nav className="exec-sidebar__nav">
            {NAV_ITEMS.map((label, i) => (
              <div key={label} className={`exec-sidebar__item ${i === 0 ? 'exec-sidebar__item--active' : ''}`}>
                <div className="exec-sidebar__icon" />
                <div>{label}</div>
              </div>
            ))}
          </nav>
          <div className="exec-sidebar__spacer" />
          <div className="exec-sidebar__avatar">FD</div>
        </aside>

        <div className="exec-main">
          <header className="exec-header">
            <div className="exec-header__title">Counter</div>
            {branchName && (
              <div className="exec-header__branch">
                <div className="exec-header__branch-label">Branch</div>
                <div className="exec-header__branch-value">{branchName}</div>
              </div>
            )}
            <div className="exec-header__spacer" />
            <div className={`exec-chip ${linked ? 'exec-chip--success' : 'exec-chip--danger'}`}>
              <div className="exec-chip__dot" />
              {linked ? 'Connected' : 'Not connected'}
              <button type="button" className="exec-chip__action" onClick={() => void pairing.unlink()}>
                Unlink
              </button>
            </div>
            <div className="exec-user">
              <div className="exec-user__name">Front desk</div>
            </div>
          </header>

          {resuming ? (
            <div className="centered-empty">Loading…</div>
          ) : activeContractId ? (
            <ActiveSessionPanel
              key={activeContractId}
              contractId={activeContractId}
              onSessionEnd={() => setActiveContractId(null)}
            />
          ) : (
            branchId && <SearchAndWalkIn branchId={branchId} onSessionStart={setActiveContractId} />
          )}
        </div>
      </div>
    </div>
  );
}
