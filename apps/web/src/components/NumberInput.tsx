/**
 * A whole-number field that can be emptied while typing (owner's feedback: deleting a "3" must
 * not put a "1" back, otherwise typing "2" gives "12"). Only valid numbers reach `onChange`; an
 * empty or out-of-range field is marked invalid (`required`, `min`, `max`), so the browser stops
 * the form from being sent until something valid is entered.
 */
import { type InputHTMLAttributes, useEffect, useState } from 'react';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & {
  value: number | null;
  onChange: (value: number) => void;
  min: number;
  max: number;
};

export function NumberInput({ value, onChange, min, max, ...rest }: Props) {
  const [text, setText] = useState(value === null ? '' : String(value));
  // A new value from outside (e.g. "unlimited" switched off) replaces what was typed.
  useEffect(() => {
    setText((current) =>
      current !== '' && Number(current) === value ? current : value === null ? '' : String(value),
    );
  }, [value]);
  return (
    <input
      type="number"
      inputMode="numeric"
      required
      min={min}
      max={max}
      {...rest}
      value={text}
      onChange={(e) => {
        const next = e.target.value;
        setText(next);
        const n = Number(next);
        if (next !== '' && Number.isInteger(n) && n >= min && n <= max) onChange(n);
      }}
    />
  );
}
