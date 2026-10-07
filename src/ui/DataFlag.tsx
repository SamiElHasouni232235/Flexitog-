export function DummyBadge({ show = true }: { show?: boolean }) {
  if (!show) return null;
  return (
    <span className="badge dummy" title="Dummy data. Placeholder figure, not company data.">
      Dummy
    </span>
  );
}

/** Dummy badge plus the "Mark as real data" checkbox. */
export function DataFlag({ isDummy, onChange, label }: { isDummy: boolean; onChange: (isDummy: boolean) => void; label?: string }) {
  return (
    <span className="data-flag">
      {isDummy ? <DummyBadge /> : <span className="badge real">Real</span>}
      <label className="check small">
        <input
          type="checkbox"
          checked={!isDummy}
          onChange={(e) => onChange(!e.target.checked)}
          aria-label={label ? `Mark ${label} as real data` : 'Mark as real data'}
        />
        Mark as real data
      </label>
    </span>
  );
}
