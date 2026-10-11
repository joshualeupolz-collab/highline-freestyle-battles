/** Legal notice ("Impressum", § 5 DDG and § 18(2) MStV) and contact for reporting content. */
import { OperatorAddress, OperatorEmail } from './common';
import { OPERATOR, REPOSITORY_URL } from './operator';

export function ImprintEn() {
  return (
    <>
      <h1>Legal notice</h1>
      <h2>Operator (§ 5 DDG)</h2>
      <OperatorAddress lang="en" />
      <h2>Responsible for the content (§ 18(2) MStV)</h2>
      <p>{OPERATOR.name}, address as above.</p>
      <h2>Reporting content</h2>
      <p>
        Highline Battles is a free, non-commercial hobby project. Videos, messages and other content
        are added by the members, who are responsible for them. If you find content that is illegal
        or breaks the terms of use, please write to <OperatorEmail /> with a link or description of
        the content and the reason. We check every report and remove content that is illegal. This
        address is also the point of contact for authorities and users under the EU Digital Services
        Act; you can write in English or German.
      </p>
      <h2>Source code</h2>
      <p>
        The app is open source: <a href={REPOSITORY_URL}>{REPOSITORY_URL}</a>
      </p>
    </>
  );
}

export function ImprintDe() {
  return (
    <>
      <h1>Impressum</h1>
      <h2>Angaben gemäß § 5 DDG</h2>
      <OperatorAddress lang="de" />
      <h2>Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV</h2>
      <p>{OPERATOR.name}, Anschrift wie oben.</p>
      <h2>Inhalte melden</h2>
      <p>
        Highline Battles ist ein kostenloses, nicht kommerzielles Hobbyprojekt. Videos, Nachrichten
        und andere Inhalte stellen die Mitglieder ein, die dafür verantwortlich sind. Wenn dir
        rechtswidrige Inhalte oder Verstöße gegen die Nutzungsbedingungen auffallen, schreib bitte
        an <OperatorEmail /> mit einem Link oder einer Beschreibung des Inhalts und dem Grund. Wir
        prüfen jede Meldung und entfernen rechtswidrige Inhalte. Diese Adresse ist auch die
        Kontaktstelle für Behörden und Nutzer nach dem Digital Services Act der EU; du kannst auf
        Deutsch oder Englisch schreiben.
      </p>
      <h2>Quellcode</h2>
      <p>
        Die App ist Open Source: <a href={REPOSITORY_URL}>{REPOSITORY_URL}</a>
      </p>
    </>
  );
}
