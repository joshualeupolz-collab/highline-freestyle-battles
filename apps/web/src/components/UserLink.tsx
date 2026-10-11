import { useState } from 'react';
import { Link } from 'react-router';
import type { RatingView } from '../api';
import { t } from '../i18n';

/** A person's name that opens their profile. */
export function UserLink({ id, name }: { id: string; name: string }) {
  return <Link to={`/users/${id}`}>{name}</Link>;
}

/**
 * "1523 ±85", or "1338?" while the rating is provisional (rating specification §8.1).
 * Tapping the "?" explains it.
 */
export function RatingText({ rating }: { rating: RatingView | null | undefined }) {
  const [open, setOpen] = useState(false);
  const provisional = !rating || rating.provisional;
  return (
    <span className="muted">
      {rating ? rating.r : 1500}
      {provisional ? (
        <button
          type="button"
          className="rating-q"
          aria-label={t('rating.provisionalHint')}
          onClick={(e) => {
            e.preventDefault();
            setOpen(!open);
          }}
        >
          ?
        </button>
      ) : (
        ` ±${rating.rd}`
      )}
      {open && <span className="rating-hint">{t('rating.provisionalHint')}</span>}
    </span>
  );
}
