import { type BattleSettings, DEFAULT_BATTLE_SETTINGS } from '@hfb/shared';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { api, type UserHit } from '../api';
import { useMe } from '../auth';
import { partsText, SettingsFields, useFormats } from '../battleHelpers';
import { ErrorText } from '../components/ErrorText';
import { UserPicker } from '../components/UserPicker';
import { t } from '../i18n';

export function NewBattlePage() {
  const navigate = useNavigate();
  const { data: me } = useMe();
  const formats = useFormats();
  const [formatId, setFormatId] = useState('');
  const [opponent, setOpponent] = useState<UserHit | null>(null);
  const [settings, setSettings] = useState<BattleSettings>(DEFAULT_BATTLE_SETTINGS);
  const [flexible, setFlexible] = useState(false);
  const create = useMutation({
    mutationFn: api.createBattle,
    onSuccess: (res) => navigate(`/battles/${res.battle.id}`),
  });

  const list = formats.data?.formats ?? [];
  const selected = formatId || list[0]?.id || '';
  return (
    <>
      <h1>{t('new.title')}</h1>
      <form
        className="card"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate({
            formatId: selected,
            settings,
            settingsFlexible: flexible,
            invitedUserId: opponent?.id,
          });
        }}
      >
        <label>
          {t('new.format')}
          <select value={selected} onChange={(e) => setFormatId(e.target.value)}>
            {list.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name} ({partsText(f)})
              </option>
            ))}
          </select>
        </label>
        <div>
          <strong>{t('new.opponent')}</strong>
          <UserPicker value={opponent} onChange={setOpponent} excludeId={me?.id} />
          <span className="hint">{t('new.opponentHint')}</span>
        </div>
        <SettingsFields value={settings} onChange={setSettings} />
        <label className="check">
          <input
            type="checkbox"
            checked={flexible}
            onChange={(e) => setFlexible(e.target.checked)}
          />
          <span>{t('settings.flexible')}</span>
        </label>
        <ErrorText error={create.error} />
        <button type="submit" disabled={create.isPending || !selected}>
          {t('new.submit')}
        </button>
      </form>
    </>
  );
}
