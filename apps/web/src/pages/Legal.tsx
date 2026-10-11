import { useState } from 'react';
import { Link } from 'react-router';
import { t } from '../i18n';
import type { LegalLang } from '../legal/common';
import { ImprintDe, ImprintEn } from '../legal/imprint';
import { PrivacyDe, PrivacyEn } from '../legal/privacy';
import { TermsDe, TermsEn } from '../legal/terms';

const DOCS = {
  privacy: { en: PrivacyEn, de: PrivacyDe },
  terms: { en: TermsEn, de: TermsDe },
  imprint: { en: ImprintEn, de: ImprintDe },
};
export type LegalDoc = keyof typeof DOCS;

const LANG_KEY = 'hfb.legalLang';

/** The language last chosen, else German for German browsers, else English. */
function initialLang(): LegalLang {
  try {
    const stored = localStorage.getItem(LANG_KEY);
    if (stored === 'en' || stored === 'de') return stored;
  } catch {
    // Storage blocked: fall back to the browser language.
  }
  return navigator.language.toLowerCase().startsWith('de') ? 'de' : 'en';
}

/**
 * Privacy policy, terms of use and legal notice (texts in `apps/web/src/legal/`). Public, no
 * login: they must be reachable from the sign-up page and from outside the app.
 */
export function LegalPage({ doc }: { doc: LegalDoc }) {
  const [lang, setLang] = useState(initialLang);
  const choose = (value: LegalLang) => {
    setLang(value);
    try {
      localStorage.setItem(LANG_KEY, value);
    } catch {
      // Not remembered; fine.
    }
  };
  const Text = DOCS[doc][lang];
  return (
    <main className="legal">
      <div className="row">
        <Link to="/">← {t('appName')}</Link>
        <fieldset className="segmented legal-lang" aria-label={t('legal.language')}>
          {(['en', 'de'] as const).map((value) => (
            <button
              key={value}
              type="button"
              className={`seg-option${value === lang ? ' selected' : ''}`}
              aria-pressed={value === lang}
              onClick={() => choose(value)}
            >
              {value === 'en' ? 'English' : 'Deutsch'}
            </button>
          ))}
        </fieldset>
      </div>
      <Text />
      <LegalLinks />
    </main>
  );
}

/** Links to the three legal texts, for page footers. */
export function LegalLinks() {
  return (
    <p className="muted legal-links">
      <Link to="/privacy">{t('legal.privacy')}</Link> · <Link to="/terms">{t('legal.terms')}</Link>{' '}
      · <Link to="/imprint">{t('legal.imprint')}</Link>
    </p>
  );
}
