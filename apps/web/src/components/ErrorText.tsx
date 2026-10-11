import { ApiError } from '../api';
import { errorText, t } from '../i18n';

/** Shows an error from a mutation or query in the user's language. */
export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  const message = error instanceof ApiError ? errorText(error.code) : t('error.unknown_error');
  return (
    <p className="error" role="alert">
      {message}
    </p>
  );
}
