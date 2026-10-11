import { FORMAT_PART_KINDS } from '@hfb/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, type UserHit } from '../api';
import { partsText, useFormats } from '../battleHelpers';
import { ErrorText } from '../components/ErrorText';
import { UserPicker } from '../components/UserPicker';
import { formatDate, type MessageKey, t } from '../i18n';

export function AdminPage() {
  return (
    <>
      <h1>{t('admin.title')}</h1>
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

function Formats() {
  const formats = useFormats();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ slug: '', name: '', kind: 'trick_combo', count: 3 });
  const create = useMutation({
    mutationFn: api.createFormat,
    onSuccess: () => {
      setForm({ slug: '', name: '', kind: 'trick_combo', count: 3 });
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
          <span className="badge">{f.status}</span>
        </div>
      ))}
      <h2>{t('admin.newFormat')}</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate({
            slug: form.slug.trim(),
            name: form.name.trim(),
            parts: [{ kind: form.kind, count: form.count }],
          });
        }}
      >
        <label>
          {t('admin.name')}
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
          />
        </label>
        <label>
          {t('admin.slug')}
          <input
            value={form.slug}
            onChange={(e) => setForm({ ...form, slug: e.target.value })}
            required
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
          />
        </label>
        <label>
          {t('admin.partKind')}
          <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
            {FORMAT_PART_KINDS.filter((k) => k !== 'response').map((k) => (
              <option key={k} value={k}>
                {t(`part.${k}` as MessageKey)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('admin.count')}
          <input
            type="number"
            min={1}
            max={100}
            value={form.count}
            onChange={(e) => setForm({ ...form, count: Number(e.target.value) })}
          />
        </label>
        <ErrorText error={create.error} />
        <button type="submit" disabled={create.isPending}>
          {t('admin.create')}
        </button>
      </form>
    </section>
  );
}
