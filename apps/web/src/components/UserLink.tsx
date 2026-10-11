import { Link } from 'react-router';
import type { RatingView } from '../api';

/** A person's name that opens their profile. */
export function UserLink({ id, name }: { id: string; name: string }) {
  return <Link to={`/users/${id}`}>{name}</Link>;
}

/** "1523 ±85", with "?" while the rating is provisional (rating specification §8.1). */
export function RatingText({ rating }: { rating: RatingView | null | undefined }) {
  if (!rating) return <span className="muted">1500?</span>;
  return (
    <span className="muted">
      {rating.r}
      {rating.provisional ? '?' : ''} ±{rating.rd}
    </span>
  );
}
