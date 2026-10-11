import type { FormatPart } from '@hfb/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, type UserHit } from '../api';
import { partsText, useFormats } from '../battleHelpers';
import { ErrorText } from '../components/ErrorText';
import { PartsFields } from '../components/PartsFields';
import { UserPicker } from '../components/UserPicker';
import { formatDate, t } from '../i18n';

export function AdminPage() {
  return (
    <>
      <h1>{t('admin.title')}</h1>
      <Proposals />
      <ResetCode />
      <Formats />
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
