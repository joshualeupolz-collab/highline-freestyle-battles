import { type FormatPart, SELECTABLE_PART_KINDS } from '@hfb/shared';
import { type MessageKey, t } from '../i18n';

type Kind = (typeof SELECTABLE_PART_KINDS)[number];

/**
 * Editor for the parts of a format. Each part is one video: a number of tricks, a number of
 * bounces, or something else described in free text.
 */
export function PartsFields({
  value,
  onChange,
}: {
  value: FormatPart[];
  onChange: (parts: FormatPart[]) => void;
}) {
  const set = (i: number, part: FormatPart) => onChange(value.map((p, j) => (j === i ? part : p)));
  const setKind = (i: number, kind: Kind) =>
    set(
      i,
      kind === 'other'
        ? { kind, label: value[i]?.label ?? '' }
        : { kind, count: value[i]?.count ?? 3 },
    );

  return (
    <fieldset className="field">
      <legend>{t('formats.parts')}</legend>
      <span className="hint">{t('formats.partsHint')}</span>
      {value.map((part, i) => {
        const kind: Kind =
          part.kind === 'bounce_combo'
            ? 'bounce_combo'
            : part.kind === 'other'
              ? 'other'
              : 'trick_combo';
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: parts have no id; their order is their identity
          <div className="card part" key={i}>
            <div className="row">
              <strong>{t('formats.video', { n: i + 1 })}</strong>
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
            <fieldset className="segmented" aria-label={t('formats.partType')}>
              {SELECTABLE_PART_KINDS.map((k) => (
                <button
                  type="button"
                  key={k}
                  aria-pressed={kind === k}
                  className={`seg-option${kind === k ? ' selected' : ''}`}
                  onClick={() => setKind(i, k)}
                >
                  {t(`formats.kind.${k}` as MessageKey)}
                </button>
              ))}
            </fieldset>
            <span className="hint">{t(`formats.kindHint.${kind}` as MessageKey)}</span>
            {kind === 'other' ? (
              <label>
                {t('formats.otherLabel')}
                <input
                  value={part.label ?? ''}
                  onChange={(e) => set(i, { kind: 'other', label: e.target.value })}
                  maxLength={200}
                  required
                  placeholder={t('formats.otherPlaceholder')}
                />
              </label>
            ) : (
              <label>
                {t(kind === 'trick_combo' ? 'formats.countTricks' : 'formats.countBounces')}
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={100}
                  value={part.count ?? 1}
                  onChange={(e) =>
                    set(i, { kind, count: Math.max(1, Number(e.target.value) || 1) })
                  }
                />
              </label>
            )}
          </div>
        );
      })}
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
