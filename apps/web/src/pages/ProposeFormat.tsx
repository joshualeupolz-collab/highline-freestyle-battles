import type { FormatPart } from '@hfb/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api';
import { partsText } from '../battleHelpers';
import { ErrorText } from '../components/ErrorText';
import { PartsFields } from '../components/PartsFields';
import { formatDate, type MessageKey, t } from '../i18n';

/** Propose a new format and follow what happened to my proposals. */
export function ProposeFormatPage() {
  const queryClient = useQueryClient();
  const proposals = useQuery({ queryKey: ['formatProposals'], queryFn: api.formatProposals });
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [parts, setParts] = useState<FormatPart[]>([{ kind: 'trick_combo', count: 3 }]);
  const propose = useMutation({
    mutationFn: api.proposeFormat,
    onSuccess: () => {
      setName('');
      setDescription('');
      return queryClient.invalidateQueries({ queryKey: ['formatProposals'] });
    },
  });

  return (
    <>
      <h1>{t('formats.proposeTitle')}</h1>
      <p className="muted">{t('formats.proposeHint')}</p>
      <form
        className="card"
        onSubmit={(e) => {
          e.preventDefault();
          propose.mutate({
            name: name.trim(),
            description: description.trim() || undefined,
            parts,
          });
        }}
      >
        <label>
          {t('admin.name')}
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            minLength={2}
            maxLength={60}
          />
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
        <PartsFields value={parts} onChange={setParts} />
        <ErrorText error={propose.error} />
        {propose.isSuccess && <p className="success">{t('formats.proposed')}</p>}
        <button type="submit" disabled={propose.isPending}>
          {t('formats.propose')}
        </button>
      </form>

      {(proposals.data?.proposals.length ?? 0) > 0 && (
        <section>
          <h2>{t('formats.myProposals')}</h2>
          {proposals.data?.proposals.map((p) => (
            <div key={p.id} className="card">
              <div className="row">
                <strong>{p.name}</strong>
                <span className={`badge ${p.state === 'approved' ? 'active' : ''}`}>
                  {t(`formats.state.${p.state}` as MessageKey)}
                </span>
              </div>
              <div className="muted">
                {partsText(p)} · {formatDate(p.createdAt)}
              </div>
              {p.reviewNote && <p style={{ margin: '0.25rem 0 0' }}>{p.reviewNote}</p>}
            </div>
          ))}
        </section>
      )}
    </>
  );
}
