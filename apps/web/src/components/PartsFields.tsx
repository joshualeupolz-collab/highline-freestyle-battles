import { FORMAT_PART_KINDS, type FormatPart } from '@hfb/shared';
import { type MessageKey, t } from '../i18n';

/** Editor for the parts of a format (e.g. "Best trick ×1" + "Trick combo ×3"). */
export function PartsFields({
  value,
  onChange,
}: {
  value: FormatPart[];
  onChange: (parts: FormatPart[]) => void;
}) {
  const set = (i: number, part: FormatPart) => onChange(value.map((p, j) => (j === i ? part : p)));
  return (
    <fieldset className="field">
      <legend>{t('formats.parts')}</legend>
      {value.map((part, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: parts have no id; their order is their identity
        <div className="inline" key={i}>
          <select
            value={part.kind}
            onChange={(e) => set(i, { ...part, kind: e.target.value as FormatPart['kind'] })}
          >
            {FORMAT_PART_KINDS.filter((k) => k !== 'response').map((k) => (
              <option key={k} value={k}>
                {t(`part.${k}` as MessageKey)}
              </option>
            ))}
          </select>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={100}
            value={part.count}
            onChange={(e) => set(i, { ...part, count: Math.max(1, Number(e.target.value) || 1) })}
            aria-label={t('admin.count')}
          />
          {value.length > 1 && (
            <button
              type="button"
              className="link"
              onClick={() => onChange(value.filter((_, j) => j !== i))}
            >
              {t('formats.removePart')}
            </button>
          )}
        </div>
      ))}
      {value.length < 10 && (
        <button
          type="button"
          className="link"
          onClick={() => onChange([...value, { kind: 'trick_combo', count: 3 }])}
        >
          {t('formats.addPart')}
        </button>
      )}
    </fieldset>
  );
}
