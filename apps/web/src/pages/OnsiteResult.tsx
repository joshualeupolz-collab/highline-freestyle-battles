import { MAX_FREE_LEVEL, ONSITE_CONFIRM_DAYS } from '@hfb/shared';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { api, type UserHit } from '../api';
import { useMe } from '../auth';
import { partsText, useFormats } from '../battleHelpers';
import { ErrorText } from '../components/ErrorText';
import { UserPicker } from '../components/UserPicker';
import { t } from '../i18n';

function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Enter the result of a battle that took place on site (concept section 8). It counts once the
 * opponent confirms it on their battle page.
 */
export function OnsiteResultPage() {
  const navigate = useNavigate();
  const { data: me } = useMe();
  const formats = useFormats();
  const [formatId, setFormatId] = useState('');
  const [opponent, setOpponent] = useState<UserHit | null>(null);
  const [date, setDate] = useState(today);
  const [level, setLevel] = useState(3);
  const [scoring, setScoring] = useState<'scale' | 'win_loss'>('scale');
  const [value, setValue] = useState<number | null>(null);
  const create = useMutation({
    mutationFn: api.createOnsiteBattle,
    onSuccess: (res) => navigate(`/battles/${res.battle.id}`),
  });

  const other = opponent?.displayName ?? t('onsite.opponent');
  // Seen from me (seat 0): +2 I was clearly better … −2 the opponent was clearly better.
  const options = [
    { value: 2, label: t('review.clearly', { name: me?.displayName ?? '' }) },
    { value: 1, label: t('review.somewhat', { name: me?.displayName ?? '' }) },
    { value: -1, label: t('review.somewhat', { name: other }) },
    { value: -2, label: t('review.clearly', { name: other }) },
  ];
  const playedAt = new Date(`${date}T12:00`).getTime();
  const ready = formatId && opponent && value !== null && !Number.isNaN(playedAt);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!ready || value === null || !opponent) return;
        create.mutate({
          formatId,
          opponentId: opponent.id,
          // Today's battle: now, so it is never "in the future"; earlier days: midday.
          playedAt: date === today() ? Date.now() : playedAt,
          level,
          scoring,
          value,
        });
      }}
    >
      <h1>{t('onsite.title')}</h1>
      <p className="hint">{t('onsite.intro', { days: ONSITE_CONFIRM_DAYS })}</p>
      <div className="card">
        <label>
          {t('new.format')}
          <select value={formatId} onChange={(e) => setFormatId(e.target.value)}>
            <option value="">–</option>
            {(formats.data?.formats ?? []).map((f) => (
              <option key={f.id} value={f.id}>
                {f.name} ({partsText(f)})
              </option>
            ))}
          </select>
        </label>
        <div>
          <strong>{t('onsite.opponent')}</strong>
          <UserPicker value={opponent} onChange={setOpponent} excludeId={me?.id} />
        </div>
        <label>
          {t('onsite.date')}
          <input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label>
          {t('settings.level')}
          <select value={level} onChange={(e) => setLevel(Number(e.target.value))}>
            {Array.from({ length: MAX_FREE_LEVEL }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('settings.scoring')}
          <select
            value={scoring}
            onChange={(e) => setScoring(e.target.value as 'scale' | 'win_loss')}
          >
            <option value="scale">{t('settings.scale')}</option>
            <option value="win_loss">{t('settings.win_loss')}</option>
          </select>
        </label>
      </div>
      <div className="card">
        <strong>{t('onsite.result')}</strong>
        <div className="vote-options">
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              className={o.value === value ? '' : 'secondary'}
              onClick={() => setValue(o.value)}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
      <ErrorText error={create.error} />
      <button type="submit" disabled={!ready || create.isPending}>
        {t('onsite.submit', { name: other })}
      </button>
    </form>
  );
}
