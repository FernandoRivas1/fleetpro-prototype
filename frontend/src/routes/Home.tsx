import { Link } from 'react-router-dom';

/** Dev convenience only — not part of the product's route map. */
export function Home() {
  return (
    <div className="debug-panel">
      <h1>Fleetpro</h1>
      <p className="debug-panel__hint">Dev links:</p>
      <div className="debug-panel__actions">
        <Link to="/executive">
          <button type="button">Executive console</button>
        </Link>
        <Link to="/client">
          <button type="button" className="debug-panel__button--ghost">
            Client tablet
          </button>
        </Link>
        <Link to="/precheckin">
          <button type="button" className="debug-panel__button--ghost">
            Pre check-in portal
          </button>
        </Link>
      </div>
    </div>
  );
}
