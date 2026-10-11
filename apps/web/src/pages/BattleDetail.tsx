import type { BattleSettings } from '@hfb/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useParams } from 'react-router';
import { api, type Battle, type Proposal } from '../api';
import { useMe } from '../auth';
import { partsText, SettingsFields, StatusBadge, settingsText, useFormats } from '../battleHelpers';
import {
  BattleVideos,
  OpponentProgress,
  UnlockedVideos,
  VideoPlayer,
} from '../components/BattleVideos';
import { Chat } from '../components/Chat';
import { ErrorText } from '../components/ErrorText';
import { ReviewCard } from '../components/Review';
import { RatingText, UserLink } from '../components/UserLink';
import { formatDate, type MessageKey, t } from '../i18n';

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

  return (
    <>
      <div className="row">
        <h1 style={{ margin: 0 }}>{format?.name ?? '…'}</h1>
        <StatusBadge status={battle.status} mode={battle.mode} />
      </div>
      {format && <p className="muted">{partsText(format)}</p>}

      <div className="card">
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
        </div>
        {battle.participants.length < 2 && (
          <span className="muted"> – {t('battles.waitingForOpponent')}</span>
        )}
        <p className="muted" style={{ margin: '0.25rem 0 0' }}>
          {onsite
            ? `${t('onsite.played', { date: formatDate(battle.playedAt ?? battle.createdAt) })} · ${settingsText({ level: battle.settings.level, scoring: battle.settings.scoring })}`
            : settingsText(battle.settings)}
        </p>
        {battle.deadlineAt && battle.status === 'active' && (
          <p style={{ margin: '0.25rem 0 0' }}>
            {t('battle.deadline')}: {formatDate(battle.deadlineAt)}
          </p>
        )}
        {battle.participants
          .filter((p) => (p.extraAttempts ?? 0) > 0)
          .map((p) => (
            <p key={p.userId} className="muted" style={{ margin: 0 }}>
              {p.displayName}: {t('battle.extraAttempts', { n: p.extraAttempts ?? 0 })}
            </p>
          ))}
        {mine && <OpponentProgress battle={battle} myId={me.id} />}
      </div>

      {!onsite && (battle.status === 'open' || battle.status === 'negotiating') && (
        <div className={`card ${battle.settingsFlexible ? '' : 'notice'}`}>
          <span className={`badge ${battle.settingsFlexible ? 'negotiating' : 'fixed'}`}>
            {battle.settingsFlexible ? t('rules.flexible') : t('rules.fixed')}
          </span>{' '}
          {battle.settingsFlexible ? t('rules.flexibleHint') : t('rules.fixedHint')}
        </div>
      )}

      <Result battle={battle} name={name} />
      <ErrorText error={action.error} />

      {battle.proposals.length > 0 && (
        <section>
          <h2>{t('battle.proposals')}</h2>
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
              // Accepting the settings during negotiation starts the battle, accepting an
              // on-site result decides it: both are binding.
              binding={
                (battle.status === 'negotiating' && p.kind === 'settings') || p.kind === 'result'
              }
            />
          ))}
        </section>
      )}

      {onsite && battle.status === 'negotiating' && mine && (
        <div className="card notice">
          {t('onsite.pending', { date: formatDate(battle.deadlineAt ?? Date.now()) })}
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
                const other = battle.participants.find((p) => p.userId !== me.id);
                const who = value > 0 ? me.displayName : (other?.displayName ?? '?');
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
      {battle.status === 'cancelled' && battle.cancelReason === 'onsite_withdrawn' && (
        <p className="card">{t('onsite.withdrawn')}</p>
      )}
      {battle.status === 'active' && mine && battle.deadlinePassed && (
        <div className="card notice">
          {t('battle.deadlinePassed')}
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
      {format && <UnlockedVideos battle={battle} format={format} />}
      {battle.status === 'reviewing' && mine && (
        <ReviewCard
          battle={battle}
          myId={me.id}
          busy={action.isPending}
          onVote={(value) => run('vote', { value })}
        />
      )}
      {battle.status === 'cancelled' && battle.cancelReason === 'no_agreement' && (
        <p className="card">{t('review.noAgreement')}</p>
      )}
      {battle.status === 'active' && mine && format && (
        <BattleVideos battle={battle} format={format} myId={me.id} />
      )}

      <div className="actions">
        {battle.status === 'open' && !isCreator && (
          <button
            type="button"
            onClick={() =>
              (battle.settingsFlexible || window.confirm(t('battle.bindingConfirm'))) &&
              run('accept')
            }
          >
            {battle.settingsFlexible ? t('battle.acceptNegotiable') : t('battle.accept')}
          </button>
        )}
        {battle.status === 'open' && isCreator && (
          <button type="button" className="danger" onClick={() => run('retract')}>
            {t('battle.retract')}
          </button>
        )}
        {!onsite && battle.status === 'negotiating' && mine?.seat === 1 && (
          <button
            type="button"
            onClick={() => window.confirm(t('battle.bindingConfirm')) && run('start')}
          >
            {t('battle.start')}
          </button>
        )}
        {running && mine && (
          <button
            type="button"
            className="secondary"
            onClick={() => setPanel(panel === 'settings' ? 'none' : 'settings')}
          >
            {t('battle.proposeSettings')}
          </button>
        )}
        {battle.status === 'active' && mine && (
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
            {battle.participants.some((p) => p.userId !== me.id && (p.extraAttempts ?? 0) > 0) && (
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
        {running && mine && (
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

      {mine && battle.participants.length > 1 && (
        <Chat battleId={battle.id} myId={me.id} participants={battle.participants} />
      )}

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
    </>
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
}: {
  proposal: Proposal;
  myId: string;
  name: (id: string) => string;
  otherThan: (userId: string) => string;
  onAction: (path: string, body?: unknown) => void;
  binding: boolean;
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
        <input
          type="number"
          min={1}
          max={60}
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
        />
      </label>
      <p className="muted">
        {t('battle.deadline')}: {formatDate(base + days * DAY)}
      </p>
      <button type="submit">{t('battle.send')}</button>
    </form>
  );
}
