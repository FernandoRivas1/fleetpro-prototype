import { useEffect, useState } from 'react';
import { useStationPairing } from '../../pairing/StationPairingContext';
import { getStation, listBranches, type BranchRead } from '../../lib/api';
import { SearchAndWalkIn } from './SearchAndWalkIn';
import { ActiveSessionPanel } from './ActiveSessionPanel';
import { PreCheckinPage } from './PreCheckinPage';
import './executive.css';

const NAV_ITEMS = ['Counter', 'Contracts', 'Fleet', 'Drivers', 'Station', 'Reports'];
const NAV_TITLES: Record<string, string> = { Drivers: 'Pre check-in' };
// Only these sidebar destinations are wired — the rest is out of scope
// (see main.py's own "wired in as they're implemented" note for the
// domains behind them).
const WIRED_NAV = new Set(['Counter', 'Drivers']);

/** The app chrome (Fleetpro Shells design, 1b) wrapping the search/walk-in
 * screen, the active session panel, or the Pre Check-in queue. */
export function ExecutiveShell() {
  const pairing = useStationPairing();
  const [branchId, setBranchId] = useState<string | null>(null);
  const [branches, setBranches] = useState<BranchRead[]>([]);
  const [activeContractId, setActiveContractId] = useState<string | null>(null);
  const [resuming, setResuming] = useState(true);
  const [activeNav, setActiveNav] = useState('Counter');
  // Multi-branch switching (Executive Main design): the station's own
  // branch_id (from pairing) is only the *default* — an executive working
  // a big multi-branch counter (an airport counter serving several
  // nearby branches, say) can browse/serve another branch's reservations
  // and vehicles without re-pairing the station. null means "use the
  // station's own branch"; resets on reload, same as the mockup.
  const [workingBranchId, setWorkingBranchId] = useState<string | null>(null);
  const [branchMenuOpen, setBranchMenuOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

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

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const effectiveBranchId = workingBranchId ?? branchId;
  const branchName = branches.find((b) => b.id === effectiveBranchId)?.name ?? '';
  const linked = pairing.status === 'open';

  const selectBranch = (b: BranchRead) => {
    setBranchMenuOpen(false);
    if (b.id === effectiveBranchId) return;
    setWorkingBranchId(b.id);
    setToast(`Working branch set to ${b.name}`);
  };

  return (
    <div className="exec-page">
      <div className="exec-shell">
        <aside className="exec-sidebar">
          <div className="exec-sidebar__logo">F</div>
          <nav className="exec-sidebar__nav">
            {NAV_ITEMS.map((label) => (
              <div
                key={label}
                className={`exec-sidebar__item ${label === activeNav ? 'exec-sidebar__item--active' : ''}`}
                style={{ cursor: WIRED_NAV.has(label) ? 'pointer' : 'default' }}
                onClick={() => WIRED_NAV.has(label) && setActiveNav(label)}
              >
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
            <div className="exec-header__title">{NAV_TITLES[activeNav] ?? activeNav}</div>
            {branchName && (
              <div className="exec-header__branch-wrap">
                <div
                  className={`exec-header__branch exec-header__branch--clickable ${branchMenuOpen ? 'exec-header__branch--open' : ''}`}
                  onClick={() => setBranchMenuOpen((v) => !v)}
                >
                  <div className="exec-header__branch-label">Branch</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div className="exec-header__branch-value">{branchName}</div>
                    <div className="exec-header__branch-arrow">▼</div>
                  </div>
                </div>

                {branchMenuOpen && (
                  <>
                    <div className="click-catcher" onClick={() => setBranchMenuOpen(false)} />
                    <div className="branch-menu">
                      <div className="branch-menu__label">Your branches</div>
                      {branches.map((b) => {
                        const active = b.id === effectiveBranchId;
                        return (
                          <div
                            key={b.id}
                            className={`branch-menu__item ${active ? 'branch-menu__item--active' : ''}`}
                            onClick={() => selectBranch(b)}
                          >
                            <div className="branch-menu__dot" />
                            <div>
                              <div className="branch-menu__name">{b.name}</div>
                              {b.address && <div className="branch-menu__meta">{b.address}</div>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
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
          ) : activeNav === 'Drivers' ? (
            effectiveBranchId && <PreCheckinPage branchId={effectiveBranchId} />
          ) : activeContractId ? (
            <ActiveSessionPanel
              key={activeContractId}
              contractId={activeContractId}
              onSessionEnd={() => setActiveContractId(null)}
            />
          ) : (
            effectiveBranchId && <SearchAndWalkIn branchId={effectiveBranchId} onSessionStart={setActiveContractId} />
          )}
        </div>
      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
