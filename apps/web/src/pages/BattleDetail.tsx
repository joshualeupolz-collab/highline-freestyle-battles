import type { BattleSettings } from '@hfb/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { api, type Battle, type Proposal } from '../api';
import { hasRole, useMe } from '../auth';
import {
  formatColor,
  partsText,
  SettingsFields,
  StatusBadge,
  settingsChips,
  settingsText,
  useFormats,
} from '../battleHelpers';
import {
  BattleVideos,
  OpponentProgress,
  UnlockedVideos,
  VideoPlayer,
} from '../components/BattleVideos';
import { Chat } from '../components/Chat';
import { ErrorText } from '../components/ErrorText';
import { GroupPending, GroupResultList } from '../components/GroupResult';
import { NumberInput } from '../components/NumberInput';
import { LostHint } from '../components/OfflineReservations';
import { ReportButton } from '../components/ReportButton';
import { ReviewCard, ReviewerCard } from '../components/Review';
import { RatingText, UserLink } from '../components/UserLink';
import { formatDate, formatShort, type MessageKey, t } from '../i18n';
import { nextStep, todoOf } from '../nextStep';

const DAY = 86_400_000;

export function BattleDetailPage() {
  const { id = '' } = useParams();
  const { data: me } = useMe();
  const formats = useFormats();
  const queryClient = useQueryClient();
  const battleQuery = useQuery({ queryKey: ['battle', id], queryFn: () => api.battle(id) });
  const action = useMutation({
    mutationFn: ({ path, body }: { path: string; body?: unknown }) =>
      api.battleAction(id, path, body),
    onSuccess: (res) => {
      queryClient.setQueryData(['battle', id], res);
      void queryClient.invalidateQueries({ queryKey: ['myBattles'] });
    },
  });
  const [panel, setPanel] = useState<'none' | 'settings' | 'extension' | 'result'>('none');

  if (battleQuery.isLoading || !me) return <p className="muted">{t('common.loading')}</p>;
  const battle = battleQuery.data?.battle;
  if (!battle) return <ErrorText error={battleQuery.error} />;

  const run = (path: string, body?: unknown) => {
    setPanel('none');
    action.mutate({ path, body });
  };
  const format = formats.data?.formats.find((f) => f.id === battle.formatId);
  const mine = battle.participants.find((p) => p.userId === me.id);
  const isCreator = battle.createdBy === me.id;
  const onsite = battle.mode === 'onsite';
  const running = !onsite && (battle.status === 'negotiating' || battle.status === 'active');
  const name = (userId: string) =>
    battle.participants.find((p) => p.userId === userId)?.displayName ?? '?';

  const opponent = battle.participants.find((p) => p.userId !== me.id);
  const step =
    mine && format ? nextStep(battle, todoOf(battle, me.id, format.parts.length), me.id) : null;
  const myProposalsOnly = battle.proposals.length > 0;
  const chips = onsite
    ? [
        t('meta.onsite', { date: formatShort(battle.playedAt ?? battle.createdAt) }),
        t('meta.weight', { n: battle.settings.level }),
        battle.kind === 'group'
          ? t('group.chip', { n: battle.participants.length })
          : battle.settings.scoring === 'scale'
            ? t('meta.margin')
            : t('meta.winLoss'),
      ]
    : settingsChips(battle.settings);

  return (
    <>
      <div className="battle-head" style={{ borderLeftColor: formatColor(battle.formatId) }}>
        <div className="row">
          <h1 style={{ margin: 0 }}>{format?.name ?? '…'}</h1>
          <StatusBadge status={battle.status} mode={battle.mode} />
        </div>
        {format && (
          <div className="format-parts" style={{ color: formatColor(battle.formatId) }}>
            {partsText(format)}
          </div>
        )}
        <div className="versus">
          {battle.participants.map((p, i) => (
            <span key={p.userId}>
              {i > 0 && <span className="muted"> {t('battles.vs')} </span>}
              <strong>
                <UserLink id={p.userId} name={p.displayName} />
              </strong>{' '}
              <RatingText rating={p.rating} />
            </span>
          ))}
          {battle.participants.length < 2 && (
            <span className="muted">
              {' '}
              –{' '}
              {battle.invitedUserId === me.id
                ? t('battle.challengesYou')
                : t('battles.waitingForOpponent')}
            </span>
          )}
        </div>
        <div className="chips">
          {chips.map((chip) => (
            <span key={chip} className="chip">
              {chip}
            </span>
          ))}
        </div>
      </div>
      {battle.participants
        .filter((p) => (p.extraAttempts ?? 0) > 0)
        .map((p) => (
          <p key={p.userId} className="battle-meta">
            {p.displayName}: {t('battle.extraAttempts', { n: p.extraAttempts ?? 0 })}
          </p>
        ))}

      {battle.kind === 'group' ? (
        <GroupResultList battle={battle} />
      ) : (
        <Result battle={battle} name={name} />
      )}
      {battle.status === 'cancelled' && (
        <p className="card">
          {battle.cancelReason === 'no_agreement'
            ? t('review.noAgreement')
            : battle.cancelReason === 'onsite_withdrawn'
              ? t('onsite.withdrawn')
              : t('battle.cancelled')}
        </p>
      )}

      {battle.competitionId && (
        <p className="battle-meta">
          <Link to={`/competitions/${battle.competitionId}`}>{t('competitions.partOfLink')}</Link>
        </p>
      )}
      {battle.annulment?.state === 'annulled' && (
        <div className="card notice">
          <p style={{ margin: 0 }}>
            {t('annul.annulled', { reason: battle.annulment.reason ?? '' })}
          </p>
          {battle.annulment.ratingsPending && <p className="hint">{t('annul.ratingsPending')}</p>}
        </div>
      )}
      {battle.annulment?.state === 'pending' && (
        <p className="card">{t('annul.pending', { reason: battle.annulment.reason })}</p>
      )}

      {step && (
        <div className={`card next-step${step.urgent ? ' urgent' : ''}`}>
          <span className="next-label">{t('battle.nextStep')}</span>
          <strong>{t(step.key, { opponent: opponent?.displayName ?? '' })}</strong>
          {mine && <OpponentProgress battle={battle} myId={me.id} />}
        </div>
      )}
      <ErrorText error={action.error} />

      {/* What to do now, right under the next step. */}
      {battle.status === 'open' && !isCreator && (
        <div className="card">
          <p className="hint" style={{ marginTop: 0 }}>
            {battle.settingsFlexible ? t('rules.flexibleHint') : t('rules.fixedHint')}
          </p>
          <button
            type="button"
            className="wide"
            onClick={() =>
              (battle.settingsFlexible || window.confirm(t('battle.bindingConfirm'))) &&
              run('accept')
            }
          >
            {battle.settingsFlexible ? t('battle.acceptNegotiable') : t('battle.accept')}
          </button>
        </div>
      )}
      {!onsite && battle.status === 'negotiating' && mine?.seat === 1 && (
        <div className="actions">
          <button
            type="button"
            onClick={() => window.confirm(t('battle.bindingConfirm')) && run('start')}
          >
            {t('battle.start')}
          </button>
        </div>
      )}

      <GroupPending battle={battle} />

      {myProposalsOnly && battle.kind !== 'group' && (
        <section>
          {battle.proposals.map((p) => (
            <ProposalCard
              key={p.id}
              proposal={p}
              myId={me.id}
              name={name}
              otherThan={(userId) =>
                battle.participants.find((x) => x.userId !== userId)?.userId ?? ''
              }
              onAction={run}
              lost={(userId) =>
                battle.participants.find((x) => x.userId === userId)?.lostReservations ?? 0
              }
              // Accepting the settings during negotiation starts the battle, accepting an
              // on-site result decides it: both are binding.
              binding={
                (battle.status === 'negotiating' && p.kind === 'settings') || p.kind === 'result'
              }
            />
          ))}
        </section>
      )}

      {onsite && battle.status === 'negotiating' && mine && battle.kind !== 'group' && (
        <div className="card">
          <p className="hint" style={{ marginTop: 0 }}>
            {t('onsite.pending', { date: formatDate(battle.deadlineAt ?? Date.now()) })}
          </p>
          <div className="actions">
            <button
              type="button"
              className="secondary"
              onClick={() => setPanel(panel === 'result' ? 'none' : 'result')}
            >
              {t('onsite.otherResult')}
            </button>
            <button
              type="button"
              className="danger"
              onClick={() => window.confirm(t('onsite.withdrawConfirm')) && run('withdraw-onsite')}
            >
              {t('onsite.withdraw')}
            </button>
          </div>
          {panel === 'result' && (
            <div className="vote-options">
              {[2, 1, -1, -2].map((value) => {
                const who = value > 0 ? me.displayName : (opponent?.displayName ?? '?');
                return (
                  <button
                    key={value}
                    type="button"
                    className="secondary"
                    onClick={() => run('proposals', { kind: 'result', value })}
                  >
                    {t(Math.abs(value) === 2 ? 'review.clearly' : 'review.somewhat', { name: who })}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {battle.status === 'active' && mine && battle.deadlinePassed && (
        <div className="card">
          <p style={{ marginTop: 0 }}>{t('battle.deadlinePassed')}</p>
          <div className="actions">
            <button type="button" onClick={() => run('deadline-decision', { choice: 'claim_win' })}>
              {t('battle.claimWin')}
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => run('deadline-decision', { choice: 'cancel' })}
            >
              {t('battle.cancelUnrated')}
            </button>
          </div>
        </div>
      )}

      {battle.status === 'active' && mine && format && (
        <BattleVideos battle={battle} format={format} myId={me.id} />
      )}
      {format && <UnlockedVideos battle={battle} format={format} />}
      {battle.status === 'reviewing' && mine && (
        <ReviewCard
          battle={battle}
          myId={me.id}
          busy={action.isPending}
          onVote={(value) => run('vote', { value })}
          onEscalate={() => run('escalate')}
        />
      )}
      {!mine && <ReviewerCard battle={battle} />}

      {mine && battle.participants.length > 1 && (
        <Chat battleId={battle.id} myId={me.id} participants={battle.participants} />
      )}

      {/* Rarely needed: kept out of the way. */}
      {((running && mine) || (battle.status === 'open' && isCreator)) && (
        <details className="card more">
          <summary>{t('battle.moreOptions')}</summary>
          <div className="actions">
            {battle.status === 'open' && isCreator && (
              <button type="button" className="danger" onClick={() => run('retract')}>
                {t('battle.retract')}
              </button>
            )}
            {running && (
              <button
                type="button"
                className="secondary"
                onClick={() => setPanel(panel === 'settings' ? 'none' : 'settings')}
              >
                {t('battle.proposeSettings')}
              </button>
            )}
            {battle.status === 'active' && (
              <>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setPanel(panel === 'extension' ? 'none' : 'extension')}
                >
                  {t('battle.proposeExtension')}
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() =>
                    window.confirm(t('battle.grantAttemptConfirm')) && run('grant-attempt')
                  }
                >
                  {t('battle.grantAttempt')}
                </button>
                {battle.participants.some(
                  (p) => p.userId !== me.id && (p.extraAttempts ?? 0) > 0,
                ) && (
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => run('proposals', { kind: 'extra_attempt', change: -1 })}
                  >
                    {t('battle.takeBackAttempt')}
                  </button>
                )}
              </>
            )}
            {running && (
              <button
                type="button"
                className="danger"
                onClick={() =>
                  window.confirm(t('battle.giveUpConfirm')) && run('proposals', { kind: 'cancel' })
                }
              >
                {t('battle.giveUp')}
              </button>
            )}
          </div>
          {panel === 'settings' && (
            <SettingsProposal
              battle={battle}
              onSend={(changes) => run('proposals', { kind: 'settings', changes })}
            />
          )}
          {panel === 'extension' && (
            <ExtensionProposal
              battle={battle}
              onSend={(deadlineAt) => run('proposals', { kind: 'extension', deadlineAt })}
            />
          )}
        </details>
      )}
      {battle.status === 'decided' &&
        !battle.annulment &&
        !mine &&
        hasRole(me, 'federation', 'admin') && <AnnulCard battleId={battle.id} />}
      {battle.status !== 'open' && <ReportButton targetType="battle" targetId={battle.id} />}
    </>
  );
}

/** Federation (and admins, with approval): annul a decided battle (concept section 11). */
function AnnulCard({ battleId }: { battleId: string }) {
  const queryClient = useQueryClient();
  const annul = useMutation({
    mutationFn: (reason: string) => api.annulBattle(battleId, reason),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['battle', battleId] }),
  });
  return (
    <details className="card more">
      <summary>{t('annul.title')}</summary>
      <p className="hint">{t('annul.hint')}</p>
      <button
        type="button"
        className="danger"
        disabled={annul.isPending}
        onClick={() => {
          const reason = window.prompt(t('annul.prompt'))?.trim();
          if (reason) annul.mutate(reason);
        }}
      >
        {t('annul.button')}
      </button>
      {annul.data && (
        <p className="success">
          {annul.data.status === 'annulled' ? t('annul.done') : t('annul.requested')}
        </p>
      )}
      <ErrorText error={annul.error} />
    </details>
  );
}

function Result({ battle, name }: { battle: Battle; name: (id: string) => string }) {
  if (battle.status !== 'decided') return null;
  const winner = battle.participants.find((p) => (p.score ?? 0) > 0.5);
  const reason = battle.decisionReason
    ? t(`battle.reason.${battle.decisionReason}` as MessageKey)
    : '';
  // Scores with margin, e.g. 0.875 : 0.125 (concept 7.5).
  const margin = battle.participants.some((p) => p.score !== 0 && p.score !== 1)
    ? ` (${battle.participants.map((p) => p.score).join(' : ')})`
    : '';
  return (
    <div className="card">
      <strong>{t('battle.result')}: </strong>
      {winner
        ? t('battle.won', { name: name(winner.userId) })
        : battle.participants.map((p) => `${p.displayName} ${p.score}`).join(' · ')}
      {margin} <span className="muted">{reason}</span>
      {battle.ratingChanges.map((r) => {
        const diff = Math.round(r.after - r.before);
        return (
          <div key={r.userId} className="muted">
            {name(r.userId)}: {Math.round(r.before)} → {Math.round(r.after)} (
            {diff >= 0 ? `+${diff}` : diff})
          </div>
        );
      })}
    </div>
  );
}

function ProposalCard({
  proposal,
  myId,
  name,
  otherThan,
  onAction,
  binding,
  lost,
}: {
  proposal: Proposal;
  myId: string;
  name: (id: string) => string;
  otherThan: (userId: string) => string;
  onAction: (path: string, body?: unknown) => void;
  binding: boolean;
  /** Reservations never reported back by this athlete (lost devices). */
  lost: (userId: string) => number;
}) {
  const value = proposal.payload.value ?? 0;
  const text =
    proposal.kind === 'result'
      ? t('onsite.proposal', {
          result: t(Math.abs(value) === 2 ? 'review.clearly' : 'review.somewhat', {
            // The value is seen from the proposer: positive = the proposer was better.
            name: name(value > 0 ? proposal.proposedBy : otherThan(proposal.proposedBy)),
          }),
        })
      : proposal.kind === 'settings'
        ? t('battle.proposal.settings', { changes: settingsText(proposal.payload.changes ?? {}) })
        : proposal.kind === 'extension'
          ? t('battle.proposal.extension', { date: formatDate(proposal.payload.deadlineAt ?? 0) })
          : proposal.kind === 'extra_attempt'
            ? proposal.payload.change === 1
              ? t('battle.proposal.extraAttempt')
              : t('battle.proposal.takeBack')
            : t('battle.proposal.cancel');
  const own = proposal.proposedBy === myId;
  const base = `proposals/${proposal.id}`;
  return (
    <div className="card">
      <div>{text}</div>
      <div className="muted">{t('battle.proposedBy', { name: name(proposal.proposedBy) })}</div>
      {proposal.payload.videoId && <VideoPlayer id={proposal.payload.videoId} />}
      {proposal.kind === 'extra_attempt' && !own && lost(proposal.proposedBy) > 0 && (
        <LostHint n={lost(proposal.proposedBy)} />
      )}
      <div className="actions">
        {own ? (
          <button type="button" className="secondary" onClick={() => onAction(`${base}/withdraw`)}>
            {t('battle.withdrawProposal')}
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={() =>
                (!binding || window.confirm(t('battle.bindingConfirm'))) &&
                onAction(`${base}/respond`, { decision: 'accept' })
              }
            >
              {t('battle.acceptProposal')}
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => onAction(`${base}/respond`, { decision: 'reject' })}
            >
              {t('battle.rejectProposal')}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function SettingsProposal({
  battle,
  onSend,
}: {
  battle: Battle;
  onSend: (changes: Partial<BattleSettings>) => void;
}) {
  const [value, setValue] = useState<BattleSettings>(battle.settings);
  const changes = Object.fromEntries(
    Object.entries(value).filter(([k, v]) => battle.settings[k as keyof BattleSettings] !== v),
  ) as Partial<BattleSettings>;
  return (
    <form
      className="card"
      onSubmit={(e) => {
        e.preventDefault();
        onSend(changes);
      }}
    >
      <SettingsFields value={value} onChange={setValue} />
      <button type="submit" disabled={Object.keys(changes).length === 0}>
        {t('battle.send')}
      </button>
    </form>
  );
}

function ExtensionProposal({
  battle,
  onSend,
}: {
  battle: Battle;
  onSend: (deadlineAt: number) => void;
}) {
  const [days, setDays] = useState(3);
  const base = Math.max(battle.deadlineAt ?? Date.now(), Date.now());
  return (
    <form
      className="card"
      onSubmit={(e) => {
        e.preventDefault();
        onSend(base + days * DAY);
      }}
    >
      <label>
        {t('battle.extensionDays')}
        <NumberInput min={1} max={60} value={days} onChange={setDays} />
      </label>
      <p className="muted">
        {t('battle.deadline')}: {formatDate(base + days * DAY)}
      </p>
      <button type="submit">{t('battle.send')}</button>
    </form>
  );
}
