import { type BattleSettings, DEFAULT_BATTLE_SETTINGS } from '@hfb/shared';
import { useMutation } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { api, type Format, type UserHit } from '../api';
import { useMe } from '../auth';
import { partsText, SettingsFields, useFormats } from '../battleHelpers';
import { ErrorText } from '../components/ErrorText';
import { UserPicker } from '../components/UserPicker';
import { t } from '../i18n';

/**
 * Like starting a game on Lichess: pick a tile (official formats first, "more formats" for
 * the rest), then adjust the settings below and post the request.
 */
export function NewBattlePage() {
  const navigate = useNavigate();
  const { data: me } = useMe();
  const formats = useFormats();
  const [selected, setSelected] = useState<Format | null>(null);
  const [showMore, setShowMore] = useState(false);
  const [opponent, setOpponent] = useState<UserHit | null>(null);
  const [settings, setSettings] = useState<BattleSettings>(DEFAULT_BATTLE_SETTINGS);
  const [flexible, setFlexible] = useState(false);
  const settingsRef = useRef<HTMLFormElement>(null);
  const create = useMutation({
    mutationFn: api.createBattle,
    onSuccess: (res) => navigate(`/battles/${res.battle.id}`),
  });

  const list = formats.data?.formats ?? [];
  const official = list.filter((f) => f.status === 'relevant');
  const more = list.filter((f) => f.status !== 'relevant');
  const choose = (format: Format) => {
    setSelected(format);
    // Let the settings render, then bring them into view on small screens.
    setTimeout(
      () => settingsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
      50,
    );
  };
  const tiles = (items: Format[]) => (
    <div className="tiles">
      {items.map((f) => (
        <button
          type="button"
          key={f.id}
          className={`tile${selected?.id === f.id ? ' selected' : ''}`}
          onClick={() => choose(f)}
          aria-pressed={selected?.id === f.id}
        >
          <strong>{f.name}</strong>
          <span>{partsText(f)}</span>
        </button>
      ))}
    </div>
  );

  return (
    <>
      <h1>{t('new.title')}</h1>
      {formats.isLoading && <p className="muted">{t('common.loading')}</p>}
      {tiles(official)}
      {more.length > 0 && (
        <button type="button" className="link" onClick={() => setShowMore(!showMore)}>
          {showMore ? t('new.lessFormats') : t('new.moreFormats', { n: more.length })}
        </button>
      )}
      {showMore && tiles(more)}
      <p className="muted">
        <Link to="/formats/propose">{t('new.proposeFormat')}</Link>
      </p>

      {selected && (
        <form
          ref={settingsRef}
          className="card"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate({
              formatId: selected.id,
              settings,
              settingsFlexible: flexible,
              invitedUserId: opponent?.id,
            });
          }}
        >
          <h2 style={{ marginTop: 0 }}>{selected.name}</h2>
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
          <button type="submit" disabled={create.isPending}>
            {opponent ? t('new.challenge', { name: opponent.displayName }) : t('new.submit')}
          </button>
        </form>
      )}
    </>
  );
}
