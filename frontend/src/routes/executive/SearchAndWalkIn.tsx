import { useState } from 'react';
import { ReservationSearchTab } from './ReservationSearchTab';
import { WalkInTab } from './WalkInTab';

const TABS = ['Search Reservation', 'New Walk-in'] as const;

export function SearchAndWalkIn({
  branchId,
  onSessionStart,
}: {
  branchId: string;
  onSessionStart: (contractId: string) => void;
}) {
  const [tab, setTab] = useState<(typeof TABS)[number]>('Search Reservation');

  return (
    <div className="exec-body">
      <div className="exec-tabs">
        {TABS.map((label) => (
          <button
            key={label}
            type="button"
            className={`exec-tab ${tab === label ? 'exec-tab--active' : ''}`}
            onClick={() => setTab(label)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'Search Reservation' ? (
        <ReservationSearchTab branchId={branchId} onSessionStart={onSessionStart} />
      ) : (
        <WalkInTab onSessionStart={onSessionStart} />
      )}
    </div>
  );
}
