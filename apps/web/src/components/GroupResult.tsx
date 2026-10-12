/**
 * On-site group battles (concept section 8): entering placements, and the card on the battle
 * page where everyone confirms – or an official confirms for everyone.
 */
import { GROUP_MAX, GROUP_MIN } from '@hfb/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, type Battle, type UserHit } from '../api';
import { hasRole, useMe } from '../auth';
import { t } from '../i18n';
import { ErrorText } from './ErrorText';
import { UserPicker } from './UserPicker';

export interface Placed {
  user: UserHit;
  placement: number;
}

/** "1st", "2nd", … */
export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

/**
 * Everyone with a placement (1 = best, equal places allowed). With `canAdd`, people can be
 * added and removed (the first one, oneself, stays).
 */
export function PlacementEditor({
  value,
  onChange,
  canAdd,
}: {
  value: Placed[];
  onChange: (value: Placed[]) => void;
  canAdd: boolean;
}) {
  const n = value.length;
  const set = (i: number, placement: number) =>
    onChange(value.map((p, k) => (k === i ? { ...p, placement } : p)));
  return (
    <div className="placements">
      {value.map((p, i) => (
        <div key={p.user.id} className="row">
          <span>
            <strong>{p.user.displayName}</strong> <span className="muted">@{p.user.username}</span>
          </span>
          <span className="actions">
            <select
              aria-label={t('group.placeOf', { name: p.user.displayName })}
              value={p.placement}
              onChange={(e) => set(i, Number(e.target.value))}
            >
              {Array.from({ length: Math.max(n, 1) }, (_, k) => k + 1).map((place) => (
                <option key={place} value={place}>
                  {ordinal(place)}
                </option>
              ))}
            </select>
            {canAdd && i > 0 && (
              <button
                type="button"
                className="secondary"
                onClick={() => onChange(value.filter((_, k) => k !== i))}
              >
                {t('group.remove')}
              </button>
            )}
          </span>
        </div>
      ))}
      {canAdd && n < GROUP_MAX && (
        <UserPicker
          value={null}
          onChange={(u) =>
            u &&
            !value.some((p) => p.user.id === u.id) &&
            onChange([...value, { user: u, placement: n + 1 }])
          }
        />
      )}
    </div>
  );
}

/** Problems with the placements, or null when they can be sent. */
export function placementProblem(value: Placed[]): string | null {
  if (value.length < GROUP_MIN) return t('group.tooFew', { n: GROUP_MIN });
  if (value.some((p) => p.placement > value.length)) return t('group.placeTooHigh');
  if (new Set(value.map((p) => p.placement)).size < 2) return t('group.allSame');
  return null;
}

export const placementsBody = (value: Placed[]) =>
  value.map((p) => ({ userId: p.user.id, placement: p.placement }));

/** The pending result of a group battle on its page. */
export function GroupPending({ battle }: { battle: Battle }) {
  const { data: me } = useMe();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Placed[] | null>(null);
  const action = useMutation({
    mutationFn: ({ path, body }: { path: string; body?: unknown }) =>
      api.battleAction(battle.id, path, body),
    onSuccess: (res) => {
      setEditing(null);
      queryClient.setQueryData(['battle', battle.id], res);
      return queryClient.invalidateQueries({ queryKey: ['myBattles'] });
    },
  });
  if (!me || battle.kind !== 'group' || battle.status !== 'negotiating') return null;
  const proposal = battle.proposals.find((p) => p.kind === 'result');
  const placements = proposal?.payload.placements ?? [];
  const person = (id: string) => battle.participants.find((p) => p.userId === id);
  const mine = !!person(me.id);
  const iConfirmed = !!proposal?.acceptedBy.includes(me.id);
  const official = !mine && hasRole(me, 'judge', 'organizer', 'federation');
  const asPlaced = (): Placed[] =>
    battle.participants.map((p) => ({
      user: { id: p.userId, username: p.username, displayName: p.displayName },
      placement: placements.find((x) => x.userId === p.userId)?.placement ?? 1,
    }));

  return (
    <div className="card notice">
      <h2 style={{ marginTop: 0 }}>{t('group.result')}</h2>
      {proposal ? (
        <ol className="placement-list">
          {[...placements]
            .sort((a, b) => a.placement - b.placement)
            .map((p) => (
              <li key={p.userId}>
                <strong>{ordinal(p.placement)}</strong> {person(p.userId)?.displayName ?? '?'}{' '}
                <span className="muted">
                  {proposal.acceptedBy.includes(p.userId) ? t('group.confirmed') : t('group.open')}
                </span>
              </li>
            ))}
        </ol>
      ) : (
        <p>{t('group.noResult')}</p>
      )}
      <p className="hint">{t('group.howItCounts')}</p>
      <ErrorText error={action.error} />
      {mine && !editing && (
        <div className="actions">
          {proposal && !iConfirmed && (
            <button
              type="button"
              onClick={() =>
                window.confirm(t('battle.bindingConfirm')) &&
                action.mutate({ path: 'group-confirm' })
              }
            >
              {t('group.confirm')}
            </button>
          )}
          {proposal && !iConfirmed && (
            <button
              type="button"
              className="secondary"
              onClick={() => action.mutate({ path: 'group-reject' })}
            >
              {t('group.reject')}
            </button>
          )}
          <button type="button" className="secondary" onClick={() => setEditing(asPlaced())}>
            {t('group.enterOther')}
          </button>
          <button
            type="button"
            className="danger"
            onClick={() =>
              window.confirm(t('onsite.withdrawConfirm')) &&
              action.mutate({ path: 'withdraw-onsite' })
            }
          >
            {t('onsite.withdraw')}
          </button>
        </div>
      )}
      {editing && (
        <>
          <PlacementEditor value={editing} onChange={setEditing} canAdd={false} />
          {placementProblem(editing) && <p className="error">{placementProblem(editing)}</p>}
          <div className="actions">
            <button
              type="button"
              disabled={!!placementProblem(editing)}
              onClick={() =>
                action.mutate({
                  path: 'group-result',
                  body: { placements: placementsBody(editing) },
                })
              }
            >
              {t('group.send')}
            </button>
            <button type="button" className="secondary" onClick={() => setEditing(null)}>
              {t('common.cancel')}
            </button>
          </div>
        </>
      )}
      {official && proposal && (
        <button
          type="button"
          onClick={() =>
            window.confirm(t('group.officialConfirm')) &&
            action.mutate({ path: 'official-confirm' })
          }
        >
          {t('group.confirmForAll')}
        </button>
      )}
    </div>
  );
}

/** Placements of a decided group battle with the rating changes. */
export function GroupResultList({ battle }: { battle: Battle }) {
  if (battle.kind !== 'group' || battle.status !== 'decided') return null;
  const change = (id: string) => {
    const r = battle.ratingChanges.find((x) => x.userId === id);
    if (!r) return '';
    const d = Math.round(r.after - r.before);
    return ` (${Math.round(r.before)} → ${Math.round(r.after)}, ${d >= 0 ? `+${d}` : d})`;
  };
  return (
    <div className="card">
      <strong>{t('battle.result')}</strong>
      <ol className="placement-list">
        {[...battle.participants]
          .sort((a, b) => (a.placement ?? 99) - (b.placement ?? 99))
          .map((p) => (
            <li key={p.userId}>
              <strong>{ordinal(p.placement ?? 0)}</strong> {p.displayName}
              <span className="muted">{change(p.userId)}</span>
            </li>
          ))}
      </ol>
    </div>
  );
}
