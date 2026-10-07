import { useState } from 'react';

interface Props {
  children: React.ReactNode;
  /** Label of the second, confirming button. */
  confirmLabel: string;
  onConfirm: () => void;
  className?: string;
  disabled?: boolean;
  ariaLabel?: string;
}

/** Two-step button: the first click asks, the second click acts. Works where browser dialogs are blocked. */
export function ConfirmButton({ children, confirmLabel, onConfirm, className, disabled, ariaLabel }: Props) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <button className={className} disabled={disabled} aria-label={ariaLabel} onClick={() => setAsking(true)}>
        {children}
      </button>
    );
  }
  return (
    <span className="row" style={{ display: 'inline-flex', flexWrap: 'nowrap', gap: 4 }}>
      <button
        className="danger"
        autoFocus
        onClick={() => {
          setAsking(false);
          onConfirm();
        }}
      >
        {confirmLabel}
      </button>
      <button onClick={() => setAsking(false)}>Cancel</button>
    </span>
  );
}
