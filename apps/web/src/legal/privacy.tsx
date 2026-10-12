/**
 * Privacy policy (GDPR Art. 13). Keep it in line with what the app really does: when a feature
 * starts processing new personal data (e.g. push notifications, public video pages, the
 * Telegram archive, Google login), update both languages and PRIVACY_UPDATED.
 */
import { Link } from 'react-router';
import { OperatorAddress, OperatorEmail } from './common';
import { PRIVACY_UPDATED } from './operator';

export function PrivacyEn() {
  return (
    <>
      <h1>Privacy policy</h1>
      <p className="muted">Last updated: {PRIVACY_UPDATED}</p>
      <p>
        Highline Battles is a free, non-commercial app for highline freestyle battles, run as a
        private hobby project. We collect only what the app needs to work. There is no advertising,
        no tracking, no analytics, no third-party cookies, and we never sell data.
      </p>

      <h2>1. Who is responsible</h2>
      <p>The controller under the General Data Protection Regulation (GDPR) is:</p>
      <OperatorAddress lang="en" />
      <p>
        For any privacy question or request, write to this e-mail address. We are not required to
        appoint a data protection officer.
      </p>

      <h2>2. Visiting the app (hosting)</h2>
      <p>
        The app and its server run on Cloudflare (see section 9). When you open the app, your
        browser necessarily sends technical data: IP address, time, the address requested and
        browser information (user agent). Cloudflare uses it to deliver the app and to protect it
        against attacks. Our server keeps technical logs (requests and errors) for at most 3 days to
        find faults.
      </p>
      <p>
        Legal basis: Art. 6(1)(f) GDPR – our legitimate interest in running the app securely and
        reliably.
      </p>

      <h2>3. Your account</h2>
      <p>When you sign up and use your account, we store:</p>
      <ul>
        <li>username and display name (visible to other members);</li>
        <li>your password – only as a salted, one-way hash; nobody, including us, can read it;</li>
        <li>your e-mail address, if you give one (optional; not visible to other members);</li>
        <li>
          your confirmation that you are at least 16 years old and that you accept the terms of use,
          each with the time;
        </li>
        <li>
          your answers to the optional questionnaire (e.g. since when you do freestyle, your
          community). Members who can approve new accounts see them while your account waits for
          approval;
        </li>
        <li>
          who approved your account and when (the "invitation tree", which helps to detect fake
          accounts), your roles, the account status and the number of failed logins (to block
          password guessing).
        </li>
      </ul>
      <p>
        Legal basis: Art. 6(1)(b) GDPR – we need this data to provide the app to you under the terms
        of use. Giving an e-mail address and answering the questionnaire is voluntary.
      </p>

      <h2>4. Login cookie and data on your device</h2>
      <p>
        After you log in, we set one cookie, <code>hfb_session</code>. It only contains a random
        session key, is valid for 30 days and is renewed while you use the app. The server stores
        the key only as a hash. We use no other cookies.
      </p>
      <p>
        So that the app works offline, it also stores on your device: the app files (service worker
        cache), recordings until they are uploaded (IndexedDB), copies of the battles you open and
        small settings such as the video quality (local storage). Offline copies are removed when
        you log out, recordings after a successful upload. Recordings on the video test page (
        <code>/lab/video</code>) never leave your device.
      </p>
      <p>
        Storing this information on your device is strictly necessary for the service you request,
        so it needs no consent (§ 25(2) no. 2 of the German TDDDG). The processing itself is based
        on Art. 6(1)(b) GDPR.
      </p>

      <h2>5. Battles, results, ratings and chat</h2>
      <p>
        When you take part in battles, we store your battle requests and challenges, the agreed
        settings and proposals, attempts, the attempt that counts, your votes in the review, on-site
        results, the outcome and the rating calculated from it, chat messages, format proposals and
        initial rating estimates.
      </p>
      <ul>
        <li>The details of a battle, its votes and its chat are visible to its participants.</li>
        <li>
          Your profile, results, ratings and rankings are visible to all logged-in, approved members
          – not to the public.
        </li>
      </ul>
      <p>
        The rating is calculated automatically with a published formula (Glicko-2) from the results.
        It is a sports ranking and has no legal or similarly significant effect on you.
      </p>
      <p>Legal basis: Art. 6(1)(b) GDPR.</p>
      <p>
        <strong>Push notifications.</strong> If you turn on notifications on a device, we store the
        address your browser's push service gives us for this device (Google for Chrome and Android,
        Apple for iPhones and Safari, Mozilla for Firefox) and which events we have to tell you
        about. The push we send contains no content and no personal data; your device then fetches
        the text from us. You can turn notifications off in your profile at any time; they are also
        removed when you log out or delete your account. Legal basis: Art. 6(1)(a) GDPR (your
        consent when turning them on).
      </p>
      <p>
        <strong>Reports and special roles.</strong> You can report a battle, a video or a profile.
        We store the report (category, your text, who reported, when) and how it was handled. Only
        the federation and the admins see reports; the person reported does not learn who reported
        them from the app. Actions by people with special roles (judge, organizer, federation,
        admin), e.g. approving accounts, handing out roles or closing reports, are recorded in an
        audit log (who, what, when, reason) that the federation and the admins can read. Legal
        basis: Art. 6(1)(f) GDPR – our legitimate interest in fair competition, safety and traceable
        decisions.
      </p>

      <h2>6. Videos</h2>
      <p>
        Videos you record in the app show you and possibly your voice and surroundings. They stay on
        your phone until they are uploaded to our storage (Cloudflare R2, stored in Western Europe).
        For every video you choose who may watch it:
      </p>
      <ul>
        <li>
          <strong>public</strong> – currently visible to all logged-in members. Public pages without
          login may come later; we will tell you before that happens.
        </li>
        <li>
          <strong>logged-in users only</strong>.
        </li>
        <li>
          <strong>review only</strong> – only for the battle, deleted afterwards.
        </li>
      </ul>
      <p>
        Attempts that do not count are visible only to you. Attempts that do not count (unless you
        keep them) and review-only videos are deleted 7 days after the battle ended. If you want to
        change the visibility of a video or have it deleted, write to us (for videos filmed by
        friends you can change it yourself).
      </p>
      <p>
        <strong>Filming by friends.</strong> Every athlete has an athlete code. Whoever knows it can
        film attempts for that athlete in the app without an account; they see the athlete's display
        name and running battles. Such videos belong to the athlete and are visible for the review
        only until the athlete changes that. We store the name the person filming gives (optional)
        and, for videos recorded without a battle, their short description; the athletes of the
        battle see both. Videos that are never assigned to a battle are deleted 30 days after the
        recording unless the athlete keeps them. You can renew your code at any time.
      </p>
      <p>
        Please only film other people if they agree (see the terms of use). Legal basis: Art.
        6(1)(b) GDPR.
      </p>

      <h2>7. Moderation and audit log</h2>
      <p>
        Every action taken with special permissions (e.g. approving accounts, managing formats,
        resetting passwords, recalculating ratings) is recorded with who, what, when and why. This
        keeps interventions transparent and fair. Legal basis: Art. 6(1)(f) GDPR – our legitimate
        interest in fair competition and in protecting the app from misuse.
      </p>

      <h2>8. Background jobs</h2>
      <p>
        The app is published and the ratings are recalculated with GitHub Actions (see section 9).
        For a recalculation, the job reads battle results, rating estimates and rule settings with
        internal account IDs – no names, e-mail addresses or passwords – and writes the new ratings
        back. Legal basis: Art. 6(1)(b) GDPR.
      </p>

      <h2>9. Service providers and transfers outside the EU</h2>
      <p>We use these providers, who process data on our behalf under data processing terms:</p>
      <ul>
        <li>
          <strong>Cloudflare, Inc.</strong>, 101 Townsend St., San Francisco, CA 94107, USA –
          hosting, database and video storage. Database and videos are stored in Western Europe;
          requests are handled at the Cloudflare data center closest to you.
        </li>
        <li>
          <strong>GitHub, Inc.</strong>, 88 Colin P. Kelly Jr. St., San Francisco, CA 94107, USA –
          publishing the app and background jobs (section 8).
        </li>
      </ul>
      <p>
        Both companies are based in the USA, so data may be accessed from there. Both are certified
        under the EU–US Data Privacy Framework (adequacy decision of the European Commission, Art.
        45 GDPR); in addition, the EU standard contractual clauses apply.
      </p>
      <p>
        Apart from that, data is only visible to other members as described above. We do not pass it
        on to anyone else unless the law requires it.
      </p>

      <h2>10. How long we keep data</h2>
      <ul>
        <li>Account data: until you delete your account.</li>
        <li>Login sessions: 30 days after last use; password reset codes: 24 hours.</li>
        <li>Server logs: at most 3 days.</li>
        <li>
          When you delete your account, your username, display name, e-mail address, password and
          questionnaire are removed at once, and your chat messages are deleted. Your profile
          becomes "Deleted user". Battle results and ratings stay, linked only to an internal ID,
          because the ratings of your opponents depend on them (Art. 6(1)(f) GDPR). Your videos are
          kept or deleted as you choose when deleting the account; with the deletion link you
          receive, you can have kept videos deleted later.
        </li>
        <li>
          Audit log entries are kept as long as the app is run, as they document interventions.
        </li>
        <li>
          The database provider keeps backups for up to 30 days; deleted data disappears from them
          after that time.
        </li>
      </ul>

      <h2>11. Your rights</h2>
      <p>You have the right to:</p>
      <ul>
        <li>access the data we hold about you (Art. 15 GDPR);</li>
        <li>have incorrect data corrected (Art. 16);</li>
        <li>
          have your data deleted (Art. 17) – you can delete your account yourself in your profile;
        </li>
        <li>restrict processing (Art. 18);</li>
        <li>receive your data in a common, machine-readable format (Art. 20);</li>
        <li>
          <strong>
            object at any time, on grounds relating to your particular situation, to processing
            based on Art. 6(1)(f) GDPR (Art. 21)
          </strong>
          ;
        </li>
        <li>
          lodge a complaint with a data protection supervisory authority, in particular in the
          country where you live or work, or where an infringement took place (Art. 77).
        </li>
      </ul>
      <p>
        To use your rights, write to <OperatorEmail />.
      </p>

      <h2>12. Minimum age</h2>
      <p>
        The app is meant for people aged 16 and over. Younger athletes may only use it with the
        consent of their parents, arranged with the federation case by case. If we learn that a
        person under 16 uses the app without this consent, we suspend or delete the account.
      </p>

      <h2>13. Security</h2>
      <p>
        All connections are encrypted (HTTPS). Passwords, session keys and reset codes are stored
        only as hashes. Access to the database is limited to the administrators.
      </p>

      <h2>14. Changes</h2>
      <p>
        We update this policy when the app changes, e.g. when new features process new data. The
        current version is always available in the app. See also the{' '}
        <Link to="/terms">terms of use</Link> and the <Link to="/imprint">legal notice</Link>.
      </p>
    </>
  );
}

export function PrivacyDe() {
  return (
    <>
      <h1>Datenschutzerklärung</h1>
      <p className="muted">Stand: {PRIVACY_UPDATED}</p>
      <p>
        Highline Battles ist eine kostenlose, nicht kommerzielle App für Highline-Freestyle-Battles,
        betrieben als privates Hobbyprojekt. Wir erheben nur, was die App zum Funktionieren braucht.
        Es gibt keine Werbung, kein Tracking, keine Analyse-Tools, keine Cookies von Drittanbietern,
        und wir verkaufen keine Daten.
      </p>

      <h2>1. Verantwortlicher</h2>
      <p>Verantwortlicher im Sinne der Datenschutz-Grundverordnung (DSGVO) ist:</p>
      <OperatorAddress lang="de" />
      <p>
        Für alle Fragen und Anliegen zum Datenschutz schreib bitte an diese E-Mail-Adresse. Wir sind
        nicht verpflichtet, einen Datenschutzbeauftragten zu benennen.
      </p>

      <h2>2. Aufruf der App (Hosting)</h2>
      <p>
        Die App und ihr Server laufen bei Cloudflare (siehe Abschnitt 9). Beim Öffnen der App
        übermittelt dein Browser zwangsläufig technische Daten: IP-Adresse, Zeitpunkt, die
        aufgerufene Adresse und Browserinformationen (User-Agent). Cloudflare verwendet sie, um die
        App auszuliefern und vor Angriffen zu schützen. Unser Server speichert technische Protokolle
        (Anfragen und Fehler) höchstens 3 Tage, um Fehler zu finden.
      </p>
      <p>
        Rechtsgrundlage: Art. 6 Abs. 1 lit. f DSGVO – unser berechtigtes Interesse an einem sicheren
        und zuverlässigen Betrieb der App.
      </p>

      <h2>3. Dein Konto</h2>
      <p>Bei der Registrierung und Nutzung deines Kontos speichern wir:</p>
      <ul>
        <li>Benutzername und Anzeigename (für andere Mitglieder sichtbar);</li>
        <li>
          dein Passwort – nur als gesalzener Einweg-Hash; niemand, auch wir nicht, kann es lesen;
        </li>
        <li>
          deine E-Mail-Adresse, falls du eine angibst (freiwillig; für andere Mitglieder nicht
          sichtbar);
        </li>
        <li>
          deine Bestätigung, dass du mindestens 16 Jahre alt bist und die Nutzungsbedingungen
          akzeptierst, jeweils mit Zeitpunkt;
        </li>
        <li>
          deine Antworten auf den freiwilligen Fragebogen (z. B. seit wann du Freestyle machst,
          deine Community). Mitglieder, die neue Konten freischalten können, sehen sie, solange dein
          Konto auf die Freischaltung wartet;
        </li>
        <li>
          wer dein Konto wann freigeschaltet hat (der „Einladungsbaum“, der hilft, Fake-Konten zu
          erkennen), deine Rollen, den Kontostatus und die Zahl fehlgeschlagener Anmeldungen (um das
          Erraten von Passwörtern zu verhindern).
        </li>
      </ul>
      <p>
        Rechtsgrundlage: Art. 6 Abs. 1 lit. b DSGVO – wir brauchen diese Daten, um dir die App nach
        den Nutzungsbedingungen bereitzustellen. Die Angabe einer E-Mail-Adresse und die Antworten
        auf den Fragebogen sind freiwillig.
      </p>

      <h2>4. Anmelde-Cookie und Daten auf deinem Gerät</h2>
      <p>
        Nach der Anmeldung setzen wir ein einziges Cookie, <code>hfb_session</code>. Es enthält nur
        einen zufälligen Sitzungsschlüssel, gilt 30 Tage und wird verlängert, solange du die App
        nutzt. Der Server speichert den Schlüssel nur als Hash. Weitere Cookies verwenden wir nicht.
      </p>
      <p>
        Damit die App offline funktioniert, speichert sie außerdem auf deinem Gerät: die App-Dateien
        (Service-Worker-Cache), Aufnahmen bis zum Hochladen (IndexedDB), Kopien der Battles, die du
        öffnest, und kleine Einstellungen wie die Videoqualität (Local Storage). Offline-Kopien
        werden beim Abmelden entfernt, Aufnahmen nach erfolgreichem Hochladen. Aufnahmen auf der
        Video-Testseite (<code>/lab/video</code>) verlassen dein Gerät nie.
      </p>
      <p>
        Das Speichern dieser Informationen auf deinem Gerät ist für den von dir gewünschten Dienst
        unbedingt erforderlich und braucht daher keine Einwilligung (§ 25 Abs. 2 Nr. 2 TDDDG). Die
        Verarbeitung selbst beruht auf Art. 6 Abs. 1 lit. b DSGVO.
      </p>

      <h2>5. Battles, Ergebnisse, Ratings und Chat</h2>
      <p>
        Wenn du an Battles teilnimmst, speichern wir deine Battle-Anfragen und Herausforderungen,
        die vereinbarten Einstellungen und Vorschläge, Versuche, den zählenden Versuch, deine
        Bewertungen im Review, Vor-Ort-Ergebnisse, den Ausgang und das daraus berechnete Rating,
        Chatnachrichten, Formatvorschläge und Rating-Einschätzungen.
      </p>
      <ul>
        <li>
          Details eines Battles, seine Bewertungen und sein Chat sind für die Teilnehmenden
          sichtbar.
        </li>
        <li>
          Dein Profil, deine Ergebnisse, Ratings und Ranglisten sind für alle angemeldeten,
          freigeschalteten Mitglieder sichtbar – nicht öffentlich.
        </li>
      </ul>
      <p>
        Das Rating wird automatisch mit einer veröffentlichten Formel (Glicko-2) aus den Ergebnissen
        berechnet. Es ist eine sportliche Rangliste und hat dir gegenüber keine rechtliche oder
        ähnlich erhebliche Wirkung.
      </p>
      <p>Rechtsgrundlage: Art. 6 Abs. 1 lit. b DSGVO.</p>
      <p>
        <strong>Push-Benachrichtigungen.</strong> Wenn du Benachrichtigungen auf einem Gerät
        einschaltest, speichern wir die Adresse, die uns der Push-Dienst deines Browsers für dieses
        Gerät gibt (Google bei Chrome und Android, Apple bei iPhones und Safari, Mozilla bei
        Firefox), und über welche Ereignisse wir dich informieren. Die Push-Nachricht selbst enthält
        keinen Inhalt und keine personenbezogenen Daten; dein Gerät holt den Text danach bei uns ab.
        Du kannst Benachrichtigungen jederzeit im Profil ausschalten; beim Abmelden und beim Löschen
        des Kontos werden sie ebenfalls entfernt. Rechtsgrundlage: Art. 6 Abs. 1 lit. a DSGVO (deine
        Einwilligung beim Einschalten).
      </p>
      <p>
        <strong>Meldungen und Sonderrollen.</strong> Du kannst ein Battle, ein Video oder ein Profil
        melden. Wir speichern die Meldung (Kategorie, deinen Text, wer gemeldet hat, wann) und wie
        sie bearbeitet wurde. Nur die Föderation und die Admins sehen Meldungen; die gemeldete
        Person erfährt über die App nicht, wer sie gemeldet hat. Handlungen von Personen mit
        Sonderrollen (Judge, Organizer, Föderation, Admin), z. B. Freischaltungen, Rollenvergabe
        oder das Schließen von Meldungen, werden in einem Audit-Log festgehalten (wer, was, wann,
        Begründung), das die Föderation und die Admins lesen können. Rechtsgrundlage: Art. 6 Abs. 1
        lit. f DSGVO – unser berechtigtes Interesse an fairem Wettkampf, Sicherheit und
        nachvollziehbaren Entscheidungen.
      </p>

      <h2>6. Videos</h2>
      <p>
        Videos, die du in der App aufnimmst, zeigen dich und eventuell deine Stimme und Umgebung.
        Sie bleiben auf deinem Handy, bis sie in unseren Speicher (Cloudflare R2, Speicherort
        Westeuropa) hochgeladen werden. Für jedes Video wählst du, wer es sehen darf:
      </p>
      <ul>
        <li>
          <strong>öffentlich</strong> – derzeit für alle angemeldeten Mitglieder sichtbar.
          Öffentliche Seiten ohne Anmeldung kommen eventuell später; wir informieren dich vorher.
        </li>
        <li>
          <strong>nur angemeldete Nutzer</strong>.
        </li>
        <li>
          <strong>nur Review</strong> – nur für das Battle, danach gelöscht.
        </li>
      </ul>
      <p>
        Versuche, die nicht zählen, siehst nur du. Nicht zählende Versuche (außer du behältst sie)
        und Videos „nur Review“ werden 7 Tage nach Ende des Battles gelöscht. Wenn du die
        Sichtbarkeit eines Videos ändern oder es löschen lassen möchtest, schreib uns (bei Videos,
        die Freunde gefilmt haben, kannst du sie selbst ändern).
      </p>
      <p>
        <strong>Filmen durch Freunde.</strong> Jede Athletin und jeder Athlet hat einen
        Athleten-Code. Wer ihn kennt, kann in der App ohne Konto Versuche für diese Person filmen
        und sieht dabei deren Anzeigenamen und laufende Battles. Solche Videos gehören der Athletin
        bzw. dem Athleten und sind nur für das Review sichtbar, bis sie bzw. er das ändert. Wir
        speichern den Namen, den die filmende Person angibt (freiwillig), und bei Videos ohne
        gewähltes Battle ihre kurze Beschreibung; die Beteiligten des Battles sehen beides. Videos,
        die nie einem Battle zugeordnet werden, werden 30 Tage nach der Aufnahme gelöscht, außer die
        Athletin bzw. der Athlet behält sie. Du kannst deinen Code jederzeit erneuern.
      </p>
      <p>
        Bitte filme andere Personen nur mit deren Einverständnis (siehe Nutzungsbedingungen).
        Rechtsgrundlage: Art. 6 Abs. 1 lit. b DSGVO.
      </p>

      <h2>7. Moderation und Audit-Log</h2>
      <p>
        Jede Aktion mit besonderen Rechten (z. B. Konten freischalten, Formate verwalten, Passwörter
        zurücksetzen, Ratings neu berechnen) wird mit wer, was, wann und warum protokolliert. So
        bleiben Eingriffe nachvollziehbar und fair. Rechtsgrundlage: Art. 6 Abs. 1 lit. f DSGVO –
        unser berechtigtes Interesse an fairem Wettkampf und am Schutz der App vor Missbrauch.
      </p>

      <h2>8. Hintergrundaufgaben</h2>
      <p>
        Die App wird mit GitHub Actions veröffentlicht, und die Ratings werden damit neu berechnet
        (siehe Abschnitt 9). Für eine Neuberechnung liest die Aufgabe Battle-Ergebnisse,
        Rating-Einschätzungen und Regeleinstellungen mit internen Konto-IDs – keine Namen,
        E-Mail-Adressen oder Passwörter – und schreibt die neuen Ratings zurück. Rechtsgrundlage:
        Art. 6 Abs. 1 lit. b DSGVO.
      </p>

      <h2>9. Dienstleister und Übermittlung in Drittländer</h2>
      <p>
        Wir setzen folgende Dienstleister ein, die Daten in unserem Auftrag auf Grundlage von
        Auftragsverarbeitungsbedingungen verarbeiten:
      </p>
      <ul>
        <li>
          <strong>Cloudflare, Inc.</strong>, 101 Townsend St., San Francisco, CA 94107, USA –
          Hosting, Datenbank und Videospeicher. Datenbank und Videos liegen in Westeuropa; Anfragen
          werden im nächstgelegenen Cloudflare-Rechenzentrum bearbeitet.
        </li>
        <li>
          <strong>GitHub, Inc.</strong>, 88 Colin P. Kelly Jr. St., San Francisco, CA 94107, USA –
          Veröffentlichung der App und Hintergrundaufgaben (Abschnitt 8).
        </li>
      </ul>
      <p>
        Beide Unternehmen sitzen in den USA, daher ist ein Zugriff von dort möglich. Beide sind nach
        dem EU-US Data Privacy Framework zertifiziert (Angemessenheitsbeschluss der EU-Kommission,
        Art. 45 DSGVO); zusätzlich gelten die EU-Standardvertragsklauseln.
      </p>
      <p>
        Darüber hinaus sind Daten nur wie oben beschrieben für andere Mitglieder sichtbar. Wir geben
        sie an niemanden sonst weiter, außer wenn das Gesetz es verlangt.
      </p>

      <h2>10. Speicherdauer</h2>
      <ul>
        <li>Kontodaten: bis du dein Konto löschst.</li>
        <li>
          Anmeldesitzungen: 30 Tage nach der letzten Nutzung; Codes zum Zurücksetzen des Passworts:
          24 Stunden.
        </li>
        <li>Server-Protokolle: höchstens 3 Tage.</li>
        <li>
          Wenn du dein Konto löschst, werden Benutzername, Anzeigename, E-Mail-Adresse, Passwort und
          Fragebogen sofort entfernt und deine Chatnachrichten gelöscht. Dein Profil wird zu
          „Deleted user“. Battle-Ergebnisse und Ratings bleiben, nur mit einer internen ID
          verknüpft, erhalten, weil die Ratings deiner Gegner davon abhängen (Art. 6 Abs. 1 lit. f
          DSGVO). Deine Videos werden nach deiner Wahl beim Löschen behalten oder gelöscht; mit dem
          Löschlink, den du erhältst, kannst du behaltene Videos später löschen lassen.
        </li>
        <li>
          Einträge im Audit-Log bleiben erhalten, solange die App betrieben wird, da sie Eingriffe
          dokumentieren.
        </li>
        <li>
          Der Datenbankanbieter hält Sicherungen bis zu 30 Tage vor; gelöschte Daten verschwinden
          danach auch daraus.
        </li>
      </ul>

      <h2>11. Deine Rechte</h2>
      <p>Du hast das Recht auf:</p>
      <ul>
        <li>Auskunft über die zu dir gespeicherten Daten (Art. 15 DSGVO);</li>
        <li>Berichtigung unrichtiger Daten (Art. 16);</li>
        <li>Löschung (Art. 17) – dein Konto kannst du selbst in deinem Profil löschen;</li>
        <li>Einschränkung der Verarbeitung (Art. 18);</li>
        <li>Erhalt deiner Daten in einem gängigen, maschinenlesbaren Format (Art. 20);</li>
        <li>
          <strong>
            Widerspruch jederzeit, aus Gründen, die sich aus deiner besonderen Situation ergeben,
            gegen Verarbeitungen auf Grundlage von Art. 6 Abs. 1 lit. f DSGVO (Art. 21)
          </strong>
          ;
        </li>
        <li>
          Beschwerde bei einer Datenschutz-Aufsichtsbehörde, insbesondere in dem Land, in dem du
          wohnst oder arbeitest oder in dem ein Verstoß stattfand (Art. 77).
        </li>
      </ul>
      <p>
        Um deine Rechte auszuüben, schreib an <OperatorEmail />.
      </p>

      <h2>12. Mindestalter</h2>
      <p>
        Die App ist für Personen ab 16 Jahren gedacht. Jüngere Athletinnen und Athleten dürfen sie
        nur mit Einwilligung ihrer Eltern nutzen, im Einzelfall mit dem Verband abgestimmt. Erfahren
        wir, dass eine Person unter 16 die App ohne diese Einwilligung nutzt, sperren oder löschen
        wir das Konto.
      </p>

      <h2>13. Sicherheit</h2>
      <p>
        Alle Verbindungen sind verschlüsselt (HTTPS). Passwörter, Sitzungsschlüssel und
        Rücksetz-Codes werden nur als Hash gespeichert. Zugriff auf die Datenbank haben nur die
        Administratoren.
      </p>

      <h2>14. Änderungen</h2>
      <p>
        Wir passen diese Erklärung an, wenn sich die App ändert, z. B. wenn neue Funktionen neue
        Daten verarbeiten. Die aktuelle Fassung ist immer in der App abrufbar. Siehe auch die{' '}
        <Link to="/terms">Nutzungsbedingungen</Link> und das <Link to="/imprint">Impressum</Link>.
      </p>
    </>
  );
}
