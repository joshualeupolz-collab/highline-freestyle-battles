import type { BattleSettings } from '@hfb/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useParams } from 'react-router';
import { api, type Battle, type Proposal } from '../api';
import { useMe } from '../auth';
import { partsText, SettingsFields, StatusBadge, settingsText, useFormats } from '../battleHelpers';
import { ErrorText } from '../components/ErrorText';
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
  const [panel, setPanel] = useState<'none' | 'settings' | 'extension'>('none');

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
  const running = battle.status === 'negotiating' || battle.status === 'active';
  const name = (userId: string) =>
    battle.participants.find((p) => p.userId === userId)?.displayName ?? '?';

  return (
    <>
      <div className="row">
        <h1 style={{ margin: 0 }}>{format?.name ?? '…'}</h1>
        <StatusBadge status={battle.status} />
      </div>
      {format && <p className="muted">{partsText(format)}</p>}

      <div className="card">
        <strong>
          {battle.participants.map((p) => p.displayName).join(` ${t('battles.vs')} `)}
        </strong>
        {battle.participants.length < 2 && (
          <span className="muted"> – {t('battles.waitingForOpponent')}</span>
        )}
        <p className="muted" style={{ margin: '0.25rem 0 0' }}>
          {settingsText(battle.settings)}
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
      </div>

      <Result battle={battle} name={name} />
      <ErrorText error={action.error} />

      {battle.proposals.length > 0 && (
        <section>
          <h2>{t('battle.proposals')}</h2>
          {battle.proposals.map((p) => (
            <ProposalCard key={p.id} proposal={p} myId={me.id} name={name} onAction={run} />
          ))}
        </section>
      )}

      {battle.status === 'active' && mine && (
        <div className="card notice">
          {battle.deadlinePassed ? t('battle.deadlinePassed') : t('battle.recordingLater')}
          {battle.deadlinePassed && (
            <div className="actions">
              <button
                type="button"
                onClick={() => run('deadline-decision', { choice: 'claim_win' })}
              >
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
          )}
        </div>
      )}

      <div className="actions">
        {battle.status === 'open' && !isCreator && (
          <button type="button" onClick={() => run('accept')}>
            {t('battle.accept')}
          </button>
        )}
        {battle.status === 'open' && isCreator && (
          <button type="button" className="danger" onClick={() => run('retract')}>
            {t('battle.retract')}
          </button>
        )}
        {battle.status === 'negotiating' && mine?.seat === 1 && (
          <button type="button" onClick={() => run('start')}>
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
            <button type="button" className="secondary" onClick={() => run('grant-attempt')}>
              {t('battle.grantAttempt')}
            </button>
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
  const winner = battle.participants.find((p) => p.score === 1);
  const reason = battle.decisionReason
    ? t(`battle.reason.${battle.decisionReason}` as MessageKey)
    : '';
  return (
    <div className="card">
      <strong>{t('battle.result')}: </strong>
      {winner
        ? t('battle.won', { name: name(winner.userId) })
        : battle.participants.map((p) => `${p.displayName} ${p.score}`).join(' · ')}{' '}
      <span className="muted">{reason}</span>
    </div>
  );
}

function ProposalCard({
  proposal,
  myId,
  name,
  onAction,
}: {
  proposal: Proposal;
  myId: string;
  name: (id: string) => string;
  onAction: (path: string, body?: unknown) => void;
}) {
  const text =
    proposal.kind === 'settings'
      ? t('battle.proposal.settings', { changes: settingsText(proposal.payload.changes ?? {}) })
      : proposal.kind === 'extension'
        ? t('battle.proposal.extension', { date: formatDate(proposal.payload.deadlineAt ?? 0) })
        : t('battle.proposal.cancel');
  const own = proposal.proposedBy === myId;
  const base = `proposals/${proposal.id}`;
  return (
    <div className="card">
      <div>{text}</div>
      <div className="muted">{t('battle.proposedBy', { name: name(proposal.proposedBy) })}</div>
      <div className="actions">
        {own ? (
          <button type="button" className="secondary" onClick={() => onAction(`${base}/withdraw`)}>
            {t('battle.withdrawProposal')}
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={() => onAction(`${base}/respond`, { decision: 'accept' })}
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
      {/* While the battle runs, more time is asked for with "Ask for more time". */}
      <SettingsFields
        value={value}
        onChange={setValue}
        showTimeWindow={battle.status === 'negotiating'}
      />
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
