/**
 * Validated numeric input with unit, bounds and an accessible error state. The store receives
 * only finite in-range values; the field shows an inline message otherwise.
 */
import { useEffect, useId, useState } from 'react';
import { checkNumber } from '../chemistry/validation';

interface NumberFieldProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit: string;
  onChange: (value: number) => void;
  disabled?: boolean;
  help?: string;
  testId?: string;
  format?: (v: number) => string;
}

export function NumberField({ label, value, min, max, step, unit, onChange, disabled, help, testId, format }: NumberFieldProps) {
  const id = useId();
  const toText = (v: number) => (format ? format(v) : String(v));
  const [text, setText] = useState(toText(value));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setText(toText(value));
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const commit = (raw: string) => {
    const check = checkNumber(raw, { min, max }, unit);
    if (check.ok) {
      setError(null);
      if (check.value !== value) onChange(check.value);
    } else {
      setError(check.message ?? 'Invalid value');
    }
  };

  return (
    <label className="block text-xs" htmlFor={id}>
      <span className="flex items-center justify-between">
        <span className="font-medium">{label}</span>
        <span className="tv-muted">
          {min}–{max} {unit}
        </span>
      </span>
      <input
        id={id}
        className="tv-input mt-1"
        type="number"
        inputMode="decimal"
        min={min}
        max={max}
        step={step ?? 'any'}
        value={text}
        disabled={disabled}
        aria-invalid={error ? 'true' : 'false'}
        aria-describedby={error ? `${id}-error` : help ? `${id}-help` : undefined}
        data-testid={testId}
        onChange={(e) => {
          setText(e.target.value);
          commit(e.target.value);
        }}
        onBlur={(e) => commit(e.target.value)}
      />
      {error ? (
        <span id={`${id}-error`} role="alert" className="mt-0.5 block" style={{ color: 'var(--danger)' }}>
          {error}
        </span>
      ) : help ? (
        <span id={`${id}-help`} className="tv-muted mt-0.5 block">
          {help}
        </span>
      ) : null}
    </label>
  );
}
