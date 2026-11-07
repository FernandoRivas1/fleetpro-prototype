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

// Simple 24x24 stroke icons for the sidebar, drawn inline so the app
// doesn't need an icon library for six glyphs.
const NAV_ICON_PATHS: Record<string, string[]> = {
  Counter: ['M3 10h18', 'M5 10v10h14V10', 'M4 10l2-6h12l2 6', 'M10 20v-5h4v5'],
  Contracts: ['M7 3h7l5 5v13H7z', 'M14 3v5h5', 'M10 13h6', 'M10 17h6'],
  Fleet: ['M5 16V11l2-5h10l2 5v5', 'M3 16h18', 'M7 19a1.5 1.5 0 1 0 0-.01', 'M17 19a1.5 1.5 0 1 0 0-.01', 'M5 11h14'],
  Drivers: ['M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M4 21c0-4 3.6-6 8-6s8 2 8 6'],
  Station: ['M4 5h16v11H4z', 'M9 20h6', 'M12 16v4'],
  Reports: ['M4 20V10', 'M10 20V4', 'M16 20v-7', 'M22 20H2'],
};

function NavIcon({ label }: { label: string }) {
  return (
    <svg
      className="exec-sidebar__icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {(NAV_ICON_PATHS[label] ?? []).map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

/** The app chrome (Rental Software Shells design, 1b) wrapping the search/walk-in
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
          <div className="exec-sidebar__logo">RS</div>
          <nav className="exec-sidebar__nav">
            {NAV_ITEMS.map((label) => (
              <div
                key={label}
                className={`exec-sidebar__item ${label === activeNav ? 'exec-sidebar__item--active' : ''}`}
                style={{ cursor: WIRED_NAV.has(label) ? 'pointer' : 'default' }}
                onClick={() => WIRED_NAV.has(label) && setActiveNav(label)}
              >
                <NavIcon label={label} />
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
