/**
 * "Report" link that opens a small form (concept section 11). Used on battles, videos and
 * profiles; the report goes to the federation and the admins.
 */
import { REPORT_CATEGORIES, type ReportCategory, type ReportTarget } from '@hfb/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api';
import { type MessageKey, t } from '../i18n';
import { ErrorText } from './ErrorText';

export function ReportButton({
  targetType,
  targetId,
}: {
  targetType: ReportTarget;
  targetId: string;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<ReportCategory>(
    targetType === 'user'
      ? 'fake_account'
      : targetType === 'battle'
        ? 'wrong_result'
        : 'inappropriate',
  );
  const [text, setText] = useState('');
  const send = useMutation({
    mutationFn: () => api.createReport({ targetType, targetId, category, text: text.trim() }),
    onSuccess: () => {
      setText('');
      return queryClient.invalidateQueries({ queryKey: ['myReports'] });
    },
  });

  if (send.isSuccess) return <p className="hint">{t('report.sent')}</p>;
  if (!open)
    return (
      <button type="button" className="link report-link" onClick={() => setOpen(true)}>
        {t('report.button')}
      </button>
    );
  return (
    <form
      className="card"
      onSubmit={(e) => {
        e.preventDefault();
        send.mutate();
      }}
    >
      <strong>
        {t('report.title', { target: t(`report.target.${targetType}` as MessageKey) })}
      </strong>
      <label>
        {t('report.category')}
        <select value={category} onChange={(e) => setCategory(e.target.value as ReportCategory)}>
          {REPORT_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {t(`report.category.${c}` as MessageKey)}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t('report.text')}
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          required
          minLength={3}
          maxLength={1000}
          rows={3}
        />
      </label>
      <span className="hint">{t('report.hint')}</span>
      <ErrorText error={send.error} />
      <div className="actions">
        <button type="submit" disabled={send.isPending}>
          {t('report.send')}
        </button>
        <button type="button" className="secondary" onClick={() => setOpen(false)}>
          {t('common.cancel')}
        </button>
      </div>
    </form>
  );
}
