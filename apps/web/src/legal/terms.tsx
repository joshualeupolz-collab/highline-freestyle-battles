/**
 * Terms of use. After a change that people must agree to, raise TERMS_VERSION in
 * packages/shared/src/auth.ts: every account is then asked to accept the new version once.
 */
import { TERMS_VERSION } from '@hfb/shared';
import { Link } from 'react-router';
import { OperatorEmail } from './common';
import { OPERATOR } from './operator';

export function TermsEn() {
  return (
    <>
      <h1>Terms of use</h1>
      <p className="muted">Version {TERMS_VERSION}</p>

      <h2>1. About the app</h2>
      <p>
        Highline Battles (the "app") lets highline freestyle athletes compete in battles with videos
        they film themselves and keeps a rating per battle format. It is run free of charge as a
        private, non-commercial hobby project by {OPERATOR.name} ("we", see the{' '}
        <Link to="/imprint">legal notice</Link>). These terms apply to everyone who uses the app.
      </p>
      <p>
        The app is in a <strong>test phase (beta)</strong>. Features may change, be removed or not
        work as expected, and data such as battles or ratings may have to be corrected or reset.
      </p>

      <h2>2. Highlining is your own risk</h2>
      <p>
        Highlining is dangerous. You decide yourself what you try on the line, and you are
        responsible for your own safety and for a properly rigged and secured setup. Nothing in the
        app – a battle, a deadline, a challenge or a rating – is a reason to take risks you would
        not take otherwise. Do not operate your phone while you are on the line unless it is safe.
      </p>

      <h2>3. Your account</h2>
      <ul>
        <li>
          You must be at least 16 years old. Younger athletes need the consent of their parents,
          arranged with the federation.
        </li>
        <li>
          One account per person. Give truthful information and do not pretend to be someone else.
        </li>
        <li>Keep your password secret. You are responsible for what happens with your account.</li>
        <li>
          New accounts must be approved by a member. There is no right to be approved or to use the
          app.
        </li>
      </ul>

      <h2>4. Fair play</h2>
      <ul>
        <li>
          Follow the agreed rules of each battle. Do not edit, fake or swap videos, do not record an
          attempt outside the app or the rules, and do not hide attempts that went wrong.
        </li>
        <li>Vote honestly in the review, even when you lose.</li>
        <li>
          Do not manipulate ratings, e.g. with fake accounts, arranged battles or false on-site
          results.
        </li>
        <li>Be respectful in chats and everywhere else in the app.</li>
      </ul>
      <p>
        The federation and the administrators may correct or annul battles, recalculate ratings and
        warn, suspend or remove members who break these rules. Such actions are recorded in the
        audit log.
      </p>

      <h2>5. Your content</h2>
      <p>
        You are responsible for the videos, messages, format proposals and other content you add.
        You may only upload content you have the rights to, and you may only film or show other
        people (e.g. spectators or friends filming you) if they agree. Content must not be illegal,
        offensive, discriminatory or violate the rights of others.
      </p>
      <p>
        You keep all rights to your content. You give us the free, non-exclusive right, worldwide,
        to store, technically process (e.g. cut, compress, convert) and show your content to other
        members as far as needed to run the app, and only within the visibility you chose for each
        video. This right ends when the content is deleted. If you keep your videos when deleting
        your account, it continues until you have them deleted with your deletion link.
      </p>
      <p>
        We may remove content that breaks these terms or the law. If you see such content, please
        tell us at <OperatorEmail />.
      </p>

      <h2>6. Availability</h2>
      <p>
        We run the app in our free time and with free services. There is no right to a certain
        availability or to particular features, and we may change or end the app. If we end it, we
        will tell members in advance where possible.
      </p>

      <h2>7. Liability</h2>
      <p>
        We are liable without limitation for intent and gross negligence and for injury to life,
        body or health. Otherwise, as the app is provided free of charge, we are not liable, unless
        mandatory law provides otherwise.
      </p>

      <h2>8. Ending the use</h2>
      <p>
        You can delete your account at any time in your profile. What happens to your data and
        videos is described in the <Link to="/privacy">privacy policy</Link>. We may suspend or
        delete accounts that seriously or repeatedly break these terms.
      </p>

      <h2>9. Changes to these terms</h2>
      <p>
        We may change these terms, e.g. when the app gets new features. The app shows you the new
        version and asks you to accept it before you continue. If you do not agree, you can delete
        your account.
      </p>

      <h2>10. Final provisions</h2>
      <p>
        German law applies. If you use the app as a consumer, this does not take away the protection
        of the mandatory law of the country where you live. If one provision is invalid, the others
        remain valid. These terms exist in English and German; if they differ, the German version
        prevails.
      </p>
    </>
  );
}

export function TermsDe() {
  return (
    <>
      <h1>Nutzungsbedingungen</h1>
      <p className="muted">Version {TERMS_VERSION}</p>

      <h2>1. Über die App</h2>
      <p>
        Mit Highline Battles (die „App“) können Highline-Freestyle-Athletinnen und -Athleten in
        Battles mit selbst gefilmten Videos gegeneinander antreten; die App führt ein Rating pro
        Battle-Format. Sie wird kostenlos als privates, nicht kommerzielles Hobbyprojekt von{' '}
        {OPERATOR.name} („wir“, siehe <Link to="/imprint">Impressum</Link>) betrieben. Diese
        Bedingungen gelten für alle, die die App nutzen.
      </p>
      <p>
        Die App befindet sich in einer <strong>Testphase (Beta)</strong>. Funktionen können sich
        ändern, wegfallen oder nicht wie erwartet funktionieren, und Daten wie Battles oder Ratings
        müssen eventuell korrigiert oder zurückgesetzt werden.
      </p>

      <h2>2. Highlinen auf eigenes Risiko</h2>
      <p>
        Highlinen ist gefährlich. Du entscheidest selbst, was du auf der Line versuchst, und bist
        für deine eigene Sicherheit und einen fachgerecht aufgebauten und gesicherten Aufbau
        verantwortlich. Nichts in der App – kein Battle, keine Frist, keine Herausforderung und kein
        Rating – ist ein Grund, Risiken einzugehen, die du sonst nicht eingehen würdest. Bediene
        dein Handy auf der Line nur, wenn es sicher ist.
      </p>

      <h2>3. Dein Konto</h2>
      <ul>
        <li>
          Du musst mindestens 16 Jahre alt sein. Jüngere brauchen die Einwilligung ihrer Eltern,
          abgestimmt mit dem Verband.
        </li>
        <li>Ein Konto pro Person. Mach wahre Angaben und gib dich nicht als jemand anderes aus.</li>
        <li>
          Halte dein Passwort geheim. Du bist für alles verantwortlich, was mit deinem Konto
          passiert.
        </li>
        <li>
          Neue Konten müssen von einem Mitglied freigeschaltet werden. Es besteht kein Anspruch auf
          Freischaltung oder Nutzung der App.
        </li>
      </ul>

      <h2>4. Fairplay</h2>
      <ul>
        <li>
          Halte dich an die vereinbarten Regeln jedes Battles. Bearbeite, fälsche oder tausche keine
          Videos, nimm keine Versuche außerhalb der App oder der Regeln auf und verstecke keine
          misslungenen Versuche.
        </li>
        <li>Bewerte im Review ehrlich, auch wenn du verlierst.</li>
        <li>
          Manipuliere keine Ratings, z. B. durch Fake-Konten, abgesprochene Battles oder falsche
          Vor-Ort-Ergebnisse.
        </li>
        <li>Sei respektvoll im Chat und überall sonst in der App.</li>
      </ul>
      <p>
        Der Verband und die Administratoren dürfen Battles korrigieren oder annullieren, Ratings neu
        berechnen und Mitglieder, die gegen diese Regeln verstoßen, verwarnen, sperren oder
        entfernen. Solche Maßnahmen werden im Audit-Log festgehalten.
      </p>

      <h2>5. Deine Inhalte</h2>
      <p>
        Du bist für die Videos, Nachrichten, Formatvorschläge und anderen Inhalte verantwortlich,
        die du einstellst. Du darfst nur Inhalte hochladen, an denen du die Rechte hast, und andere
        Personen (z. B. Zuschauer oder Freunde, die dich filmen) nur mit deren Einverständnis filmen
        oder zeigen. Inhalte dürfen nicht rechtswidrig, beleidigend oder diskriminierend sein oder
        Rechte anderer verletzen.
      </p>
      <p>
        Alle Rechte an deinen Inhalten bleiben bei dir. Du räumst uns das kostenlose, nicht
        ausschließliche, weltweite Recht ein, deine Inhalte zu speichern, technisch zu bearbeiten
        (z. B. schneiden, komprimieren, umwandeln) und anderen Mitgliedern anzuzeigen, soweit es für
        den Betrieb der App nötig ist, und nur im Rahmen der Sichtbarkeit, die du für jedes Video
        gewählt hast. Dieses Recht endet, wenn der Inhalt gelöscht wird. Behältst du deine Videos
        beim Löschen deines Kontos, gilt es weiter, bis du sie mit deinem Löschlink löschen lässt.
      </p>
      <p>
        Wir dürfen Inhalte entfernen, die gegen diese Bedingungen oder das Gesetz verstoßen. Wenn
        dir solche Inhalte auffallen, melde sie bitte an <OperatorEmail />.
      </p>

      <h2>6. Verfügbarkeit</h2>
      <p>
        Wir betreiben die App in unserer Freizeit und mit kostenlosen Diensten. Es besteht kein
        Anspruch auf eine bestimmte Verfügbarkeit oder bestimmte Funktionen, und wir dürfen die App
        ändern oder einstellen. Stellen wir sie ein, informieren wir die Mitglieder nach Möglichkeit
        vorher.
      </p>

      <h2>7. Haftung</h2>
      <p>
        Wir haften unbeschränkt für Vorsatz und grobe Fahrlässigkeit sowie für Schäden aus der
        Verletzung des Lebens, des Körpers oder der Gesundheit. Im Übrigen haften wir, da die App
        unentgeltlich bereitgestellt wird, nicht, soweit zwingendes Recht nichts anderes
        vorschreibt.
      </p>

      <h2>8. Ende der Nutzung</h2>
      <p>
        Du kannst dein Konto jederzeit in deinem Profil löschen. Was mit deinen Daten und Videos
        geschieht, steht in der <Link to="/privacy">Datenschutzerklärung</Link>. Wir dürfen Konten
        sperren oder löschen, die schwer oder wiederholt gegen diese Bedingungen verstoßen.
      </p>

      <h2>9. Änderungen dieser Bedingungen</h2>
      <p>
        Wir dürfen diese Bedingungen ändern, z. B. wenn die App neue Funktionen bekommt. Die App
        zeigt dir die neue Fassung und bittet dich, sie zu akzeptieren, bevor du weitermachst. Bist
        du nicht einverstanden, kannst du dein Konto löschen.
      </p>

      <h2>10. Schlussbestimmungen</h2>
      <p>
        Es gilt deutsches Recht. Nutzt du die App als Verbraucher, bleibt der Schutz durch
        zwingendes Recht des Landes, in dem du lebst, unberührt. Ist eine Bestimmung unwirksam,
        bleiben die übrigen wirksam. Diese Bedingungen gibt es auf Englisch und Deutsch; bei
        Abweichungen gilt die deutsche Fassung.
      </p>
    </>
  );
}
