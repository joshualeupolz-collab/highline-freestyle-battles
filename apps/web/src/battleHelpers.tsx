/** Small helpers shared by the battle pages. */
import {
  type BattleSettings,
  DEFAULT_BATTLE_SETTINGS,
  MAX_ATTEMPTS,
  MAX_TIME_WINDOW_HOURS,
} from '@hfb/shared';
import { useQuery } from '@tanstack/react-query';
import { api, type BattleStatus, type Format } from './api';
import { type MessageKey, t } from './i18n';

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

/** "3 days 4 h", "2 days", "5 h". */
export function durationText(hours: number): string {
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  return [
    days > 0 ? t('settings.days', { n: days }) : '',
    rest > 0 ? t('settings.hours', { n: rest }) : '',
  ]
    .filter(Boolean)
    .join(' ');
}

export function settingsText(s: Partial<BattleSettings>): string {
  const parts: string[] = [];
  if (s.attemptsPerVideo !== undefined)
    parts.push(`${t('settings.attempts')}: ${s.attemptsPerVideo ?? t('settings.unlimited')}`);
  if (s.timeWindowHours !== undefined)
    parts.push(
      `${t('settings.timeWindow')}: ${
        s.timeWindowHours === null ? t('settings.flexibleTime') : durationText(s.timeWindowHours)
      }`,
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
  showTimeWindow = true,
}: {
  value: BattleSettings;
  onChange: (s: BattleSettings) => void;
  showTimeWindow?: boolean;
}) {
  const unlimited = value.attemptsPerVideo === null;
  const noDeadline = value.timeWindowHours === null;
  const hours = value.timeWindowHours ?? DEFAULT_BATTLE_SETTINGS.timeWindowHours ?? 168;
  const setWindow = (days: number, rest: number) =>
    onChange({
      ...value,
      timeWindowHours: Math.min(MAX_TIME_WINDOW_HOURS, Math.max(1, days * 24 + rest)),
    });
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
      {showTimeWindow && (
        <fieldset className="field">
          <legend>{t('settings.timeWindow')}</legend>
          <div className="inline">
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={60}
              value={Math.floor(hours / 24)}
              disabled={noDeadline}
              onChange={(e) => setWindow(Number(e.target.value) || 0, hours % 24)}
              aria-label={t('settings.daysLabel')}
            />
            <span>{t('settings.daysLabel')}</span>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={23}
              value={hours % 24}
              disabled={noDeadline}
              onChange={(e) => setWindow(Math.floor(hours / 24), Number(e.target.value) || 0)}
              aria-label={t('settings.hoursLabel')}
            />
            <span>{t('settings.hoursLabel')}</span>
          </div>
          <label className="check">
            <input
              type="checkbox"
              checked={noDeadline}
              onChange={(e) =>
                onChange({ ...value, timeWindowHours: e.target.checked ? null : hours })
              }
            />
            <span>{t('settings.flexibleTime')}</span>
          </label>
        </fieldset>
      )}
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
