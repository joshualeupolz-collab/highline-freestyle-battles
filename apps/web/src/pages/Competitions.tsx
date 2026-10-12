/**
 * Official competitions (concept section 8): the list, creating one (organizers, federation) and
 * a competition with its results – entered by the organizer, confirmed by a judge or the
 * federation.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api, type CompetitionDetail, type UserHit } from '../api';
import { hasRole, useMe } from '../auth';
import { partsText, useFormatName, useFormats, useRuleset } from '../battleHelpers';
import { ErrorText } from '../components/ErrorText';
import { ordinal, type Placed, PlacementEditor, placementsBody } from '../components/GroupResult';
import { UserLink } from '../components/UserLink';
import { UserPicker } from '../components/UserPicker';
import { formatShort, type MessageKey, t } from '../i18n';

function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const statusText = (status: string) => t(`competitions.status.${status}` as MessageKey);

export function CompetitionsPage() {
  const { data: me } = useMe();
  const list = useQuery({ queryKey: ['competitions'], queryFn: api.competitions });
  const competitions = list.data?.competitions ?? [];
  return (
    <>
      <h1>{t('competitions.title')}</h1>
      <p className="hint">{t('competitions.hint')}</p>
      {hasRole(me, 'organizer', 'federation') && <NewCompetition />}
      <ErrorText error={list.error} />
      {list.isSuccess && competitions.length === 0 && (
        <p className="muted">{t('competitions.empty')}</p>
      )}
      {competitions.map((c) => (
        <Link key={c.id} to={`/competitions/${c.id}`} className="card">
          <div className="row">
            <strong>{c.name}</strong>
            <span className="badge">{statusText(c.status)}</span>
          </div>
          <div className="muted">
            {[
              c.startsAt ? formatShort(c.startsAt) : null,
              c.location,
              t('competitions.weight', { n: c.level }),
              t('competitions.by', { name: c.organizer.displayName }),
            ]
              .filter(Boolean)
              .join(' · ')}
          </div>
        </Link>
      ))}
    </>
  );
}

function NewCompetition() {
  const navigate = useNavigate();
  const weights = useRuleset().data?.params.weights;
  const [form, setForm] = useState({ name: '', location: '', description: '', date: today() });
  const [level, setLevel] = useState(5);
  const create = useMutation({
    mutationFn: api.createCompetition,
    onSuccess: (res) => navigate(`/competitions/${res.id}`),
  });
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [key]: e.target.value });
  return (
    <details className="card more">
      <summary>{t('competitions.new')}</summary>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate({
            name: form.name.trim(),
            location: form.location.trim() || undefined,
            description: form.description.trim() || undefined,
            startsAt: new Date(`${form.date}T12:00`).getTime(),
            level,
          });
        }}
      >
        <label>
          {t('competitions.name')}
          <input value={form.name} onChange={set('name')} required minLength={3} maxLength={100} />
        </label>
        <label>
          {t('competitions.location')}
          <input value={form.location} onChange={set('location')} maxLength={200} />
        </label>
        <label>
          {t('competitions.date')}
          <input type="date" value={form.date} onChange={set('date')} required />
        </label>
        <label>
          {t('competitions.level')}
          <select value={level} onChange={(e) => setLevel(Number(e.target.value))}>
            {[1, 2, 3, 4, 5].map((n) => {
              const factor = weights?.[n];
              return (
                <option key={n} value={n}>
                  {n}
                  {factor !== undefined && ` (${t('settings.factor', { f: factor })})`}
                </option>
              );
            })}
          </select>
          <span className="hint">
            {t('competitions.levelHint', { w4: weights?.[4] ?? '', w5: weights?.[5] ?? '' })}
          </span>
        </label>
        <label>
          {t('competitions.description')}
          <input value={form.description} onChange={set('description')} maxLength={1000} />
        </label>
        <ErrorText error={create.error} />
        <button type="submit" disabled={create.isPending}>
          {t('competitions.create')}
        </button>
      </form>
    </details>
  );
}

export function CompetitionPage() {
  const { id = '' } = useParams();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ['competition', id], queryFn: () => api.competition(id) });
  const action = useMutation({
    mutationFn: ({ path, body }: { path: string; body?: unknown }) =>
      api.competitionAction(id, path, body),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['competition', id] }),
        queryClient.invalidateQueries({ queryKey: ['competitions'] }),
      ]),
  });
  if (query.isLoading) return <p className="muted">{t('common.loading')}</p>;
  const data = query.data;
  if (!data) return <ErrorText error={query.error} />;
  const { competition: c } = data;
  const editing = data.canEdit && c.status === 'planned';

  return (
    <>
      <h1 style={{ marginBottom: 0 }}>{c.name}</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        {[
          c.startsAt ? formatShort(c.startsAt) : null,
          c.location,
          t('competitions.weight', { n: c.level }),
        ]
          .filter(Boolean)
          .join(' · ')}{' '}
        · {t('competitions.by', { name: c.organizer.displayName })}
      </p>
      <div className="chips">
        <span className="chip">{statusText(c.status)}</span>
      </div>
      {c.description && <p>{c.description}</p>}
      {c.confirmedBy && (
        <p className="success">
          {t('competitions.confirmedBy', { name: c.confirmedBy.displayName })}
        </p>
      )}
      <ErrorText error={action.error} />

      <h2>{t('competitions.results')}</h2>
      <Results
        data={data}
        canRemove={editing}
        onRemove={(battleId) => action.mutate({ path: `results/${battleId}/remove` })}
      />

      {editing && (
        <>
          <AddBattle onAdd={(body) => action.mutate({ path: 'battles', body })} />
          <AddPlacement onAdd={(body) => action.mutate({ path: 'placements', body })} />
        </>
      )}

      {data.canEdit && (
        <div className="card">
          {c.status === 'planned' ? (
            <>
              <p className="hint" style={{ marginTop: 0 }}>
                {t('competitions.submitHint')}
              </p>
              <button type="button" onClick={() => action.mutate({ path: 'submit' })}>
                {t('competitions.submit')}
              </button>
            </>
          ) : (
            <button
              type="button"
              className="secondary"
              onClick={() => action.mutate({ path: 'reopen' })}
            >
              {t('competitions.reopen')}
            </button>
          )}{' '}
          <button
            type="button"
            className="danger"
            onClick={() =>
              window.confirm(t('competitions.cancelConfirm')) && action.mutate({ path: 'cancel' })
            }
          >
            {t('competitions.cancel')}
          </button>
        </div>
      )}

      {data.canConfirm && (
        <div className="card notice">
          <p className="hint" style={{ marginTop: 0 }}>
            {t('competitions.submitHint')}
          </p>
          <button
            type="button"
            disabled={action.isPending}
            onClick={() =>
              window.confirm(t('competitions.confirmConfirm')) && action.mutate({ path: 'confirm' })
            }
          >
            {t('competitions.confirm')}
          </button>
        </div>
      )}
    </>
  );
}

function Results({
  data,
  canRemove,
  onRemove,
}: {
  data: CompetitionDetail;
  canRemove: boolean;
  onRemove: (battleId: string) => void;
}) {
  const formatName = useFormatName();
  if (data.results.length === 0) return <p className="muted">{t('competitions.noResults')}</p>;
  return (
    <>
      {data.results.map((r) => (
        <div key={r.battleId} className="card">
          <div className="row">
            <strong>
              {formatName(r.formatId)}
              {r.kind === 'placement' && ` · ${t('competitions.finalPlacement')}`}
            </strong>
            {canRemove && (
              <button type="button" className="link" onClick={() => onRemove(r.battleId)}>
                {t('competitions.remove')}
              </button>
            )}
          </div>
          {r.kind === 'single' ? (
            <div>
              {r.participants.map((p, i) => (
                <span key={p.userId}>
                  {i > 0 && <span className="muted"> {t('battles.vs')} </span>}
                  <UserLink id={p.userId} name={p.displayName} />
                  {p.score !== null && <span className="muted"> ({p.score})</span>}
                </span>
              ))}
            </div>
          ) : (
            <ol className="placement-list">
              {[...r.participants]
                .sort((a, b) => (a.placement ?? 0) - (b.placement ?? 0))
                .map((p) => (
                  <li key={p.userId}>
                    <strong>{ordinal(p.placement ?? 0)}</strong>{' '}
                    <UserLink id={p.userId} name={p.displayName} />
                  </li>
                ))}
            </ol>
          )}
          {r.cancelReason === 'superseded_by_battles' && (
            <p className="hint">{t('competitions.superseded')}</p>
          )}
          {r.status === 'decided' && (
            <Link to={`/battles/${r.battleId}`} className="muted">
              {t('battle.result')} →
            </Link>
          )}
        </div>
      ))}
    </>
  );
}

function FormatSelect({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const formats = useFormats();
  return (
    <label>
      {t('new.format')}
      <select value={value} onChange={(e) => onChange(e.target.value)} required>
        <option value="">–</option>
        {(formats.data?.formats ?? []).map((f) => (
          <option key={f.id} value={f.id}>
            {f.name} ({partsText(f)})
          </option>
        ))}
      </select>
    </label>
  );
}

function AddBattle({ onAdd }: { onAdd: (body: unknown) => void }) {
  const [formatId, setFormatId] = useState('');
  const [a, setA] = useState<UserHit | null>(null);
  const [b, setB] = useState<UserHit | null>(null);
  const [scoring, setScoring] = useState<'scale' | 'win_loss'>('scale');
  const options =
    a && b
      ? [
          { value: 2, label: t('review.clearly', { name: a.displayName }) },
          { value: 1, label: t('review.somewhat', { name: a.displayName }) },
          { value: -1, label: t('review.somewhat', { name: b.displayName }) },
          { value: -2, label: t('review.clearly', { name: b.displayName }) },
        ]
      : [];
  return (
    <details className="card more">
      <summary>{t('competitions.addBattle')}</summary>
      <FormatSelect value={formatId} onChange={setFormatId} />
      <strong>{t('competitions.personA')}</strong>
      <UserPicker value={a} onChange={setA} excludeId={b?.id} />
      <strong>{t('competitions.personB')}</strong>
      <UserPicker value={b} onChange={setB} excludeId={a?.id} />
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
      <div className="vote-options">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            className="secondary"
            disabled={!formatId}
            onClick={() => {
              if (!a || !b) return;
              onAdd({ formatId, aId: a.id, bId: b.id, scoring, value: o.value });
              setA(null);
              setB(null);
            }}
          >
            {o.label}
          </button>
        ))}
      </div>
    </details>
  );
}

function AddPlacement({ onAdd }: { onAdd: (body: unknown) => void }) {
  const [formatId, setFormatId] = useState('');
  const [placed, setPlaced] = useState<Placed[]>([]);
  const valid =
    !!formatId && placed.length >= 2 && placed.every((p) => p.placement <= placed.length);
  return (
    <details className="card more">
      <summary>{t('competitions.addPlacement')}</summary>
      <p className="hint">{t('competitions.placementHint')}</p>
      <FormatSelect value={formatId} onChange={setFormatId} />
      <PlacementEditor value={placed} onChange={setPlaced} canAdd removeFirst max={200} />
      <button
        type="button"
        disabled={!valid}
        onClick={() => {
          onAdd({ formatId, placements: placementsBody(placed) });
          setPlaced([]);
        }}
      >
        {t('competitions.add')}
      </button>
    </details>
  );
}
