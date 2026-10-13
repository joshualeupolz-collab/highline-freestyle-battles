/** Small helpers shared by the battle pages. */
import {
  type BattleSettings,
  DEADLINE_TIME_ZONE,
  defaultDeadline,
  MAX_ATTEMPTS,
  MAX_DEADLINE_DAYS,
} from '@hfb/shared';
import { useQuery } from '@tanstack/react-query';
import { api, type BattleStatus, type Format } from './api';
import { NumberInput } from './components/NumberInput';
import { formatDate, formatShort, t } from './i18n';

/** The RuleSet that applies now (e.g. the weight factors shown next to weight 1–3). */
export function useRuleset() {
  return useQuery({ queryKey: ['ruleset'], queryFn: api.currentRuleset, staleTime: 60 * 60_000 });
}

export function useFormats() {
  return useQuery({ queryKey: ['formats'], queryFn: api.formats, staleTime: 5 * 60_000 });
}

export function useFormatName() {
  const { data } = useFormats();
  return (id: string) => data?.formats.find((f) => f.id === id)?.name ?? '…';
}

/** One part in words: "3 tricks", "10 bounces", "1 trick" or the free description. */
export function partText(part: Format['parts'][number]): string {
  const n = part.count ?? 1;
  switch (part.kind) {
    case 'trick_combo':
    case 'best_trick':
      return t(n === 1 ? 'part.trick' : 'part.tricks', { n });
    case 'bounce_combo':
      return t(n === 1 ? 'part.bounce' : 'part.bounces', { n });
    default:
      return part.label ?? t('part.other');
  }
}

/** All parts of a format; several parts = several videos. */
export function partsText(format: Pick<Format, 'parts'>): string {
  return format.parts.map(partText).join(' + ');
}

/** Local date and time strings for <input type="date"> and <input type="time">. */
function toInputs(ms: number) {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

function fromInputs(date: string, time: string): number | null {
  const ms = new Date(`${date}T${time || '00:00'}`).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/** A deadline in German time, e.g. "Sun 18 Oct, 05:00" (deadlines are set in German time). */
export function germanTime(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    timeZone: DEADLINE_TIME_ZONE,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function settingsText(s: Partial<BattleSettings>): string {
  const parts: string[] = [];
  if (s.attemptsPerVideo !== undefined)
    parts.push(`${t('settings.attempts')}: ${s.attemptsPerVideo ?? t('settings.unlimited')}`);
  if (s.deadlineAt !== undefined)
    parts.push(
      `${t('battle.deadline')}: ${s.deadlineAt === null ? t('settings.flexibleTime') : formatDate(s.deadlineAt)}`,
    );
  if (s.level !== undefined) parts.push(`${t('settings.level')}: ${s.level}`);
  if (s.scoring !== undefined)
    parts.push(`${t('settings.scoring')}: ${t(`settings.${s.scoring}`)}`);
  return parts.join(' · ');
}

export function StatusBadge({ status, mode }: { status: BattleStatus; mode?: string }) {
  // An on-site battle "negotiating" waits for the opponent to confirm the result.
  const text =
    mode === 'onsite' && status === 'negotiating' ? t('status.confirming') : t(`status.${status}`);
  return <span className={`badge ${status}`}>{text}</span>;
}

/** Form fields for battle settings, used for new battles and for proposals. */
export function SettingsFields({
  value,
  onChange,
}: {
  value: BattleSettings;
  onChange: (s: BattleSettings) => void;
}) {
  const weights = useRuleset().data?.params.weights;
  const unlimited = value.attemptsPerVideo === null;
  const noDeadline = value.deadlineAt === null;
  const inputs = toInputs(value.deadlineAt ?? defaultDeadline());
  const setDeadline = (date: string, time: string) => {
    const ms = fromInputs(date, time);
    if (ms !== null) onChange({ ...value, deadlineAt: ms });
  };
  const today = toInputs(Date.now()).date;
  const lastDay = toInputs(Date.now() + MAX_DEADLINE_DAYS * 86_400_000).date;
  return (
    <>
      <fieldset className="field">
        <legend>{t('settings.attempts')}</legend>
        <div className="inline">
          <NumberInput
            min={1}
            max={MAX_ATTEMPTS}
            value={value.attemptsPerVideo}
            disabled={unlimited}
            onChange={(n) => onChange({ ...value, attemptsPerVideo: n })}
            aria-label={t('settings.attempts')}
          />
          <label className="check">
            <input
              type="checkbox"
              checked={unlimited}
              onChange={(e) =>
                onChange({ ...value, attemptsPerVideo: e.target.checked ? null : 3 })
              }
            />
            <span>{t('settings.unlimited')}</span>
          </label>
        </div>
      </fieldset>
      <fieldset className="field">
        <legend>{t('battle.deadline')}</legend>
        {!noDeadline && (
          <>
            <div className="inline">
              <input
                type="date"
                value={inputs.date}
                min={today}
                max={lastDay}
                onChange={(e) => setDeadline(e.target.value, inputs.time)}
                aria-label={t('settings.deadlineDate')}
              />
              <input
                type="time"
                value={inputs.time}
                onChange={(e) => setDeadline(inputs.date, e.target.value)}
                aria-label={t('settings.deadlineTime')}
              />
            </div>
            {value.deadlineAt !== null && (
              <span className="hint">
                {t('settings.yourTime')} ·{' '}
                {t('settings.germanTime', { date: germanTime(value.deadlineAt) })}
              </span>
            )}
          </>
        )}
        <label className="check">
          <input
            type="checkbox"
            checked={noDeadline}
            onChange={(e) =>
              onChange({ ...value, deadlineAt: e.target.checked ? null : defaultDeadline() })
            }
          />
          <span>{t('settings.flexibleTime')}</span>
        </label>
        <span className="hint">{t('settings.deadlineHint')}</span>
      </fieldset>
      <label>
        {t('settings.level')}
        <select
          value={value.level}
          onChange={(e) => onChange({ ...value, level: Number(e.target.value) })}
        >
          {[1, 2, 3].map((level) => (
            <option key={level} value={level}>
              {t(`settings.level${level}` as 'settings.level1')}
              {weights?.[level] !== undefined &&
                ` (${t('settings.factor', { f: weights[level] })})`}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t('settings.scoring')}
        <select
          value={value.scoring}
          onChange={(e) =>
            onChange({ ...value, scoring: e.target.value as BattleSettings['scoring'] })
          }
        >
          <option value="scale">{t('settings.scale')}</option>
          <option value="win_loss">{t('settings.win_loss')}</option>
        </select>
      </label>
    </>
  );
}

/** The settings as short pieces, e.g. ["3 attempts", "until Sun, 18 Oct, 05:00", "weight 3", …]. */
export function settingsChips(settings: BattleSettings): string[] {
  const n = settings.attemptsPerVideo;
  return [
    n === null ? t('meta.unlimited') : n === 1 ? t('meta.attempt') : t('meta.attempts', { n }),
    settings.deadlineAt ? t('battles.until', { date: formatShort(settings.deadlineAt) }) : '',
    t('meta.weight', { n: settings.level }),
    settings.scoring === 'scale' ? t('meta.margin') : t('meta.winLoss'),
  ].filter(Boolean);
}

/** Compact settings line, e.g. "3 tricks · 3 attempts · until Sun, 18 Oct, 05:00 · weight 3 · with margin". */
export function compactSettings(settings: BattleSettings, format?: Pick<Format, 'parts'>): string {
  return [format ? partsText(format) : '', ...settingsChips(settings)].filter(Boolean).join(' · ');
}

/**
 * A stable color per format, so a format is recognisable at a glance (list and battle page).
 * Derived from the id: no stored setting needed.
 */
export function formatColor(formatId: string): string {
  let hash = 0;
  for (const ch of formatId) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return `hsl(${hash % 360} 65% 45%)`;
}
