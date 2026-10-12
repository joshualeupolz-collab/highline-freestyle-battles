import type { FormatPart } from '@hfb/shared';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { type AuditEntry, api, type UserHit } from '../api';
import { partsText, useFormats } from '../battleHelpers';
import { ErrorText } from '../components/ErrorText';
import { PartsFields } from '../components/PartsFields';
import { UserLink } from '../components/UserLink';
import { UserPicker } from '../components/UserPicker';
import { formatDate, type MessageKey, t } from '../i18n';

export function AdminPage() {
  return (
    <>
      <h1>{t('admin.title')}</h1>
      <FederationApprovals />
      <Proposals />
      <ResetCode />
      <Formats />
      <Replay />
      <Team />
      <AuditLog />
    </>
  );
}

function ResetCode() {
  const [user, setUser] = useState<UserHit | null>(null);
  const create = useMutation({ mutationFn: (id: string) => api.createResetCode(id) });
  return (
    <section className="card">
      <h2 style={{ marginTop: 0 }}>{t('admin.resetCode')}</h2>
      <p className="muted">{t('admin.resetCodeHint')}</p>
      <UserPicker
        value={user}
        onChange={(u) => {
          setUser(u);
          create.reset();
        }}
      />
      {user && !create.data && (
        <div className="actions">
          <button type="button" onClick={() => create.mutate(user.id)} disabled={create.isPending}>
            {t('admin.createCode')}
          </button>
        </div>
      )}
      <ErrorText error={create.error} />
      {create.data && user && (
        <p>
          {t('admin.codeFor', { name: user.displayName, date: formatDate(create.data.expiresAt) })}
          <br />
          <span className="code">{create.data.code}</span>
        </p>
      )}
    </section>
  );
}

function Proposals() {
  const queryClient = useQueryClient();
  const proposals = useQuery({ queryKey: ['formatProposals'], queryFn: api.formatProposals });
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['formatProposals'] }),
      queryClient.invalidateQueries({ queryKey: ['formats'] }),
    ]);
  const approve = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'relevant' | 'fun' }) =>
      api.approveFormat(id, { status }),
    onSuccess: refresh,
  });
  const reject = useMutation({
    mutationFn: ({ id, note }: { id: string; note: string }) => api.rejectFormat(id, { note }),
    onSuccess: refresh,
  });
  const pending = (proposals.data?.proposals ?? []).filter((p) => p.state === 'pending');

  return (
    <section className="card">
      <h2 style={{ marginTop: 0 }}>{t('admin.proposals')}</h2>
      {pending.length === 0 && <p className="muted">{t('admin.noProposals')}</p>}
      <ErrorText error={approve.error ?? reject.error} />
      {pending.map((p) => (
        <div key={p.id} className="card">
          <strong>{p.name}</strong>
          <div className="muted">
            {partsText(p)} · {t('admin.proposedBy', { name: p.proposedBy.displayName ?? '?' })}
          </div>
          {p.description && <p style={{ margin: '0.25rem 0 0' }}>{p.description}</p>}
          <div className="actions">
            <button type="button" onClick={() => approve.mutate({ id: p.id, status: 'relevant' })}>
              {t('admin.approveOfficial')}
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => approve.mutate({ id: p.id, status: 'fun' })}
            >
              {t('admin.approveOther')}
            </button>
            <button
              type="button"
              className="danger"
              onClick={() => {
                const note = window.prompt(t('admin.rejectPrompt'))?.trim();
                if (note) reject.mutate({ id: p.id, note });
              }}
            >
              {t('admin.reject')}
            </button>
          </div>
        </div>
      ))}
    </section>
  );
}

function Formats() {
  const formats = useFormats();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<'relevant' | 'fun'>('relevant');
  const [parts, setParts] = useState<FormatPart[]>([{ kind: 'trick_combo', count: 3 }]);
  const create = useMutation({
    mutationFn: api.createFormat,
    onSuccess: () => {
      setName('');
      setDescription('');
      return queryClient.invalidateQueries({ queryKey: ['formats'] });
    },
  });
  return (
    <section className="card">
      <h2 style={{ marginTop: 0 }}>{t('admin.formats')}</h2>
      {(formats.data?.formats ?? []).map((f) => (
        <div key={f.id} className="row">
          <span>
            {f.name} <span className="muted">({partsText(f)})</span>
          </span>
          <span className="badge">
            {f.status === 'relevant' ? t('admin.official') : t('admin.other')}
          </span>
        </div>
      ))}
      <h2>{t('admin.newFormat')}</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate({
            name: name.trim(),
            description: description.trim() || undefined,
            status,
            parts,
          });
        }}
      >
        <label>
          {t('admin.name')}
          <input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} />
        </label>
        <label>
          {t('formats.description')}
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={500}
            rows={3}
          />
        </label>
        <label>
          {t('admin.kind')}
          <select value={status} onChange={(e) => setStatus(e.target.value as 'relevant' | 'fun')}>
            <option value="relevant">{t('admin.official')}</option>
            <option value="fun">{t('admin.other')}</option>
          </select>
        </label>
        <PartsFields value={parts} onChange={setParts} />
        <ErrorText error={create.error} />
        <button type="submit" disabled={create.isPending}>
          {t('admin.create')}
        </button>
      </form>
    </section>
  );
}

/** Ask for a full rating recalculation (done by a daily GitHub Actions job). */
function Replay() {
  const [reason, setReason] = useState('');
  const request = useMutation({ mutationFn: api.requestReplay });
  return (
    <form
      className="card"
      onSubmit={(e) => {
        e.preventDefault();
        request.mutate(reason);
      }}
    >
      <h2 style={{ marginTop: 0 }}>{t('admin.replay')}</h2>
      <p className="muted">{t('admin.replayHint')}</p>
      <label>
        {t('admin.replayReason')}
        <input value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} />
      </label>
      <ErrorText error={request.error} />
      {request.isSuccess && <p className="success">{t('admin.replayRequested')}</p>}
      <button type="submit" disabled={request.isPending}>
        {t('admin.replayButton')}
      </button>
    </form>
  );
}

/** Everyone with a special role; roles are changed on the person's profile. */
function Team() {
  const staff = useQuery({ queryKey: ['staff'], queryFn: api.staff });
  const list = staff.data?.staff ?? [];
  return (
    <section className="card">
      <h2 style={{ marginTop: 0 }}>{t('team.title')}</h2>
      <p className="muted">{t('roles.hint')}</p>
      <ErrorText error={staff.error} />
      {staff.isSuccess && list.length === 0 && <p className="muted">{t('team.empty')}</p>}
      {list.map((s) => (
        <div key={`${s.role}:${s.userId}`} className="row">
          <UserLink id={s.userId} name={s.displayName} />
          <span className="badge">{t(`role.${s.role}` as MessageKey)}</span>
        </div>
      ))}
    </section>
  );
}

function AuditLog() {
  const log = useInfiniteQuery({
    queryKey: ['audit'],
    queryFn: ({ pageParam }) => api.auditLog(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next ?? undefined,
  });
  const entries = log.data?.pages.flatMap((p) => p.entries) ?? [];
  return (
    <section className="card">
      <h2 style={{ marginTop: 0 }}>{t('audit.title')}</h2>
      <p className="muted">{t('audit.hint')}</p>
      <ErrorText error={log.error} />
      {log.isSuccess && entries.length === 0 && <p className="muted">{t('audit.empty')}</p>}
      {entries.map((e) => (
        <AuditLine key={e.id} entry={e} />
      ))}
      {log.hasNextPage && (
        <button
          type="button"
          className="secondary"
          disabled={log.isFetchingNextPage}
          onClick={() => log.fetchNextPage()}
        >
          {t('audit.more')}
        </button>
      )}
    </section>
  );
}

/** One entry: when, who, what (the action name and its details), on what, why. */
function AuditLine({ entry }: { entry: AuditEntry }) {
  const target = entry.targetUser ? (
    <UserLink id={entry.targetUser.id} name={entry.targetUser.displayName} />
  ) : entry.targetType === 'battle' && entry.targetId ? (
    <Link to={`/battles/${entry.targetId}`}>{entry.targetType}</Link>
  ) : (
    entry.targetType
  );
  const details =
    entry.payload && typeof entry.payload === 'object'
      ? Object.entries(entry.payload as Record<string, unknown>)
          .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
          .join(', ')
      : '';
  return (
    <div className="audit-line">
      <div className="muted">{formatDate(entry.createdAt)}</div>
      <div>
        {entry.actor ? (
          <UserLink id={entry.actor.id} name={entry.actor.displayName} />
        ) : (
          t('audit.system')
        )}{' '}
        <code>{entry.action}</code> {target}
        {details && <span className="muted"> ({details})</span>}
        {entry.federationApprovalBy && (
          <span className="muted">
            {' '}
            · {t('audit.approvedBy', { name: entry.federationApprovalBy.displayName })}
          </span>
        )}
      </div>
      {entry.reason && <div className="hint">{entry.reason}</div>}
    </div>
  );
}

/** Sport-related admin actions waiting for a federation member (concept section 2). */
function FederationApprovals() {
  const queryClient = useQueryClient();
  const list = useQuery({ queryKey: ['federationApprovals'], queryFn: api.federationApprovals });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['federationApprovals'] });
  const decide = useMutation({
    mutationFn: (v: { id: string; decision: 'approve' | 'reject'; note?: string }) =>
      api.decideApproval(v.id, v.decision, v.note),
    onSuccess: refresh,
  });
  const withdraw = useMutation({ mutationFn: api.withdrawApproval, onSuccess: refresh });
  const approvals = list.data?.approvals ?? [];
  return (
    <section className="card">
      <h2 style={{ marginTop: 0 }}>{t('approvals.federation')}</h2>
      <p className="muted">{t('approvals.federationHint')}</p>
      <ErrorText error={list.error ?? decide.error ?? withdraw.error} />
      {list.isSuccess && approvals.length === 0 && <p className="muted">{t('approvals.none')}</p>}
      {approvals.map((a) => (
        <div key={a.id} className="card">
          <Link to={`/battles/${a.targetId}`}>
            {t('approvals.annulBattle', { reason: a.reason })}
          </Link>
          <div className="muted">
            {t('approvals.requestedBy', { name: a.requestedBy.displayName })} ·{' '}
            {formatDate(a.createdAt)}
          </div>
          <div className="actions">
            {a.canDecide && (
              <>
                <button
                  type="button"
                  className="danger"
                  onClick={() => decide.mutate({ id: a.id, decision: 'approve' })}
                >
                  {t('approvals.approveAction')}
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    const note = window.prompt(t('approvals.rejectPrompt'));
                    if (note !== null)
                      decide.mutate({
                        id: a.id,
                        decision: 'reject',
                        note: note.trim() || undefined,
                      });
                  }}
                >
                  {t('approvals.reject')}
                </button>
              </>
            )}
            {a.canWithdraw && (
              <button type="button" className="secondary" onClick={() => withdraw.mutate(a.id)}>
                {t('approvals.withdraw')}
              </button>
            )}
          </div>
        </div>
      ))}
    </section>
  );
}
