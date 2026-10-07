import { useEffect, useState } from 'react';

interface Props {
  value: number;
  onChange: (n: number) => void;
  step?: number;
  min?: number;
  max?: number;
  label?: string;
  id?: string;
  disabled?: boolean;
  style?: React.CSSProperties;
}

/** Number field that keeps the typed text while it is not yet a valid number. */
export function NumberInput({ value, onChange, step, min, max, label, id, disabled, style }: Props) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => {
    setDraft((d) => (Number(d) === value && d.trim() !== '' ? d : String(value)));
  }, [value]);
  return (
    <input
      id={id}
      type="number"
      inputMode="decimal"
      value={draft}
      step={step ?? 'any'}
      min={min}
      max={max}
      disabled={disabled}
      aria-label={label}
      style={style}
      onChange={(e) => {
        setDraft(e.target.value);
        const n = Number(e.target.value);
        if (e.target.value.trim() !== '' && Number.isFinite(n)) {
          const clamped = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));
          onChange(clamped);
        }
      }}
      onBlur={() => setDraft(String(value))}
    />
  );
}

export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="field">
      <span>
        {label}
        {hint ? <span className="muted"> ({hint})</span> : null}
      </span>
      {children}
    </label>
  );
}
