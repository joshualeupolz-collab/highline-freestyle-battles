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
import { formatDate, type MessageKey, t } from './i18n';

export function useFormats() {
  return useQuery({ queryKey: ['formats'], queryFn: api.formats, staleTime: 5 * 60_000 });
}

export function useFormatName() {
  const { data } = useFormats();
  return (id: string) => data?.formats.find((f) => f.id === id)?.name ?? '…';
}

export function partsText(format: Format): string {
  return format.parts
    .map((p) => p.label ?? `${t(`part.${p.kind}` as MessageKey)} ×${p.count}`)
    .join(' + ');
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

export function StatusBadge({ status }: { status: BattleStatus }) {
  return <span className={`badge ${status}`}>{t(`status.${status}`)}</span>;
}

/** Form fields for battle settings, used for new battles and for proposals. */
export function SettingsFields({
  value,
  onChange,
}: {
  value: BattleSettings;
  onChange: (s: BattleSettings) => void;
}) {
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
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_ATTEMPTS}
            value={value.attemptsPerVideo ?? ''}
            disabled={unlimited}
            onChange={(e) =>
              onChange({
                ...value,
                attemptsPerVideo: Math.min(MAX_ATTEMPTS, Math.max(1, Number(e.target.value) || 1)),
              })
            }
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
        <div className="inline">
          <input
            type="date"
            value={inputs.date}
            min={today}
            max={lastDay}
            disabled={noDeadline}
            onChange={(e) => setDeadline(e.target.value, inputs.time)}
            aria-label={t('settings.deadlineDate')}
          />
          <input
            type="time"
            value={inputs.time}
            disabled={noDeadline}
            onChange={(e) => setDeadline(inputs.date, e.target.value)}
            aria-label={t('settings.deadlineTime')}
          />
        </div>
        {!noDeadline && value.deadlineAt !== null && (
          <span className="hint">
            {t('settings.germanTime', { date: germanTime(value.deadlineAt) })}
          </span>
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
          <option value={1}>{t('settings.level1')}</option>
          <option value={2}>{t('settings.level2')}</option>
          <option value={3}>{t('settings.level3')}</option>
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
