/**
 * One-time hint for iPhone users in the browser: only the installed app (home screen) keeps
 * recordings safely – in the browser, Safari may delete stored data after 7 days without use
 * (docs/video-prototype.md §3). Not shown in the installed app or on other devices.
 */
import { useState } from 'react';
import { t } from '../i18n';

const KEY = 'hfb-install-hint-dismissed';

function shouldShow(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ios =
    /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    // iPads report themselves as a Mac.
    (navigator.userAgent.includes('Macintosh') && navigator.maxTouchPoints > 1);
  const installed =
    matchMedia('(display-mode: standalone)').matches ||
    (navigator as { standalone?: boolean }).standalone === true;
  if (!ios || installed) return false;
  try {
    return localStorage.getItem(KEY) === null;
  } catch {
    return true;
  }
}

export function InstallHint() {
  const [show, setShow] = useState(shouldShow);
  if (!show) return null;
  const dismiss = () => {
    try {
      localStorage.setItem(KEY, '1');
    } catch {
      // Private mode: the hint comes back next time, which is fine.
    }
    setShow(false);
  };
  return (
    <div className="card notice install-hint">
      <strong>{t('install.title')}</strong>
      <p style={{ margin: '0.25rem 0' }}>{t('install.text')}</p>
      <button type="button" className="secondary" onClick={dismiss}>
        {t('install.dismiss')}
      </button>
    </div>
  );
}
