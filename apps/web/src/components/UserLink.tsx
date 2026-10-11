import { Link } from 'react-router';
import type { RatingView } from '../api';
import { t } from '../i18n';

/** A person's name that opens their profile. */
export function UserLink({ id, name }: { id: string; name: string }) {
  return <Link to={`/users/${id}`}>{name}</Link>;
}

/** "1523 ±85", or "1338 · provisional" while it is not settled yet (rating specification §8.1). */
export function RatingText({ rating }: { rating: RatingView | null | undefined }) {
  if (!rating) return <span className="muted">{t('rating.new')}</span>;
  return (
    <span className="muted">
      {rating.r} {rating.provisional ? `· ${t('rating.provisional')}` : `±${rating.rd}`}
    </span>
  );
}
