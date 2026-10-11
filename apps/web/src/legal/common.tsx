/** Small building blocks shared by the legal texts. */
import { OPERATOR } from './operator';

export type LegalLang = 'en' | 'de';

/** Name, postal address and e-mail of the operator. */
export function OperatorAddress({ lang }: { lang: LegalLang }) {
  return (
    <p>
      {OPERATOR.name}
      <br />
      {OPERATOR.street}
      <br />
      {OPERATOR.city}
      <br />
      {OPERATOR.country[lang]}
      <br />
      {lang === 'de' ? 'E-Mail' : 'E-mail'}: <OperatorEmail />
    </p>
  );
}

export function OperatorEmail() {
  return OPERATOR.email.includes('@') ? (
    <a href={`mailto:${OPERATOR.email}`}>{OPERATOR.email}</a>
  ) : (
    <>{OPERATOR.email}</>
  );
}
