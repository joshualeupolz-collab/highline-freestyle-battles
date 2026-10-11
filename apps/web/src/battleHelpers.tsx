/** Small helpers shared by the battle pages. */
import type { BattleSettings } from '@hfb/shared';
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

export function settingsText(s: Partial<BattleSettings>): string {
  const parts: string[] = [];
  if (s.attemptsPerVideo !== undefined)
    parts.push(`${t('settings.attempts')}: ${s.attemptsPerVideo ?? t('settings.unlimited')}`);
  if (s.timeWindowHours !== undefined)
    parts.push(
      `${t('settings.timeWindow')}: ${
        s.timeWindowHours === null
          ? t('settings.flexibleTime')
          : t('settings.days', { n: Math.round(s.timeWindowHours / 24) })
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
  return (
    <>
      <label>
        {t('settings.attempts')}
        <select
          value={value.attemptsPerVideo ?? 'unlimited'}
          onChange={(e) =>
            onChange({
              ...value,
              attemptsPerVideo:
                e.target.value === 'unlimited' ? null : (Number(e.target.value) as 1 | 2 | 3),
            })
          }
        >
          <option value="1">1</option>
          <option value="2">2</option>
          <option value="3">3</option>
          <option value="unlimited">{t('settings.unlimited')}</option>
        </select>
      </label>
      {showTimeWindow && (
        <label>
          {t('settings.timeWindow')}
          <select
            value={value.timeWindowHours ?? 'none'}
            onChange={(e) =>
              onChange({
                ...value,
                timeWindowHours: e.target.value === 'none' ? null : Number(e.target.value),
              })
            }
          >
            {[1, 2, 3, 7, 14, 30].map((d) => (
              <option key={d} value={d * 24}>
                {t('settings.days', { n: d })}
              </option>
            ))}
            <option value="none">{t('settings.flexibleTime')}</option>
          </select>
        </label>
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
