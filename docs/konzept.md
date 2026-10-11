# Highline-Freestyle-Battle-App – Konzept (v0.1)

Stand 2026-10-11 · Ergänzt die Rating-Spezifikation `rating/rating-spezifikation.md` (v1.0)

---

## 0. Ziel und Rahmen

- Web-App für Highline-Freestyle-Battles, ähnlich wie Online-Schach: Athleten treten weltweit per selbst gefilmtem Video gegeneinander an. Daraus entstehen Ranglisten pro Battle-Format und kombinierte Ranglisten.
- Zielgröße zum Start: ca. 100 aktive und 1000 registrierte Nutzer, weltweit.
- **Kostenlos und frei zugänglich.** Betriebskosten möglichst 0 €. Geringe Kosten sind okay, wenn sie die App deutlich einfacher oder besser machen.
- **Open Source** (öffentliches GitHub-Repo). Weitere Mitentwickler sollen später leicht einsteigen können.
- Die Community kennt sich, der Spaß steht im Vordergrund. Die App soll trotzdem offiziellen Charakter haben.

---

## 1. Grundprinzipien

1. **Vertrauensbasis statt Überwachung.** Sperren richten sich gegen „psychologisches Schummeln“ (z. B. „egal, ich film nochmal“), nicht gegen gezielten Betrug. Gezielter Betrug wird über Melden, Protokoll und Verband geregelt.
2. **Alles ist änderbar, wenn beide zustimmen.** Battle-Einstellungen (Versuche, Zeitfenster, Abbruch, Extraversuch …) können jederzeit per Änderungsantrag angepasst werden. Eine Seite schlägt vor, die andere bestätigt.
3. **Rohdaten sind die Wahrheit.** Gespeichert werden Battles, Ergebnisse, Einstufungen und Regelversionen. Ratings sind abgeleitet und jederzeit neu berechenbar (siehe Rating-Spezifikation).
4. **Regeln sind Daten, nicht Code.** Formate, Trickliste, Bewertungsregeln und Rating-Parameter sind versioniert. Jedes Battle merkt sich, mit welcher Version es gewertet wurde.
5. **Gewaltenteilung.** Der Admin ist für die Technik zuständig, der Verband bzw. die Sportkommission für alles Sportliche.
6. **Befangenheitsregel.** Niemand entscheidet in einer Sonderrolle über Battles, an denen er selbst beteiligt ist.

---

## 2. Rollen und Rechte

Eine Person kann mehrere Rollen haben (z. B. Athlet + Judge).

| Rolle | Rechte |
|---|---|
| **Gast** | Filmt mit einem Athleten-Code für jemand anderen. Kein eigener Account nötig. |
| **Athlet** | Battles anfragen und annehmen, Videos hochladen, im Bewertungspool bewerten, Tricks taggen, Formate vorschlagen, an Abstimmungen teilnehmen, neue Nutzer freischalten bzw. einladen, Ersteinschätzungen für Bekannte abgeben, Inhalte melden |
| **Judge** | zusätzlich: Bewertungsstufe 3, Freigabe von Battle-Gewichtung 4–5 |
| **Orga** | Offizielle Competitions anlegen, Ergebnisse eintragen |
| **Verband / Sportkommission** | Judge- und Orga-Rollen vergeben, Nutzer freischalten, Ersteinstufungen setzen bzw. überschreiben, Ergebnisse bestätigen, revidieren oder annullieren, Strafen vergeben, Meldungen bearbeiten, Formate, Trickliste und Regelwerk verwalten, Beta-Formate zum Standard machen |
| **Admin** (2–3 Personen) | Technik, Deployments, Datenbank, Backups. Hat grundsätzlich auch die Verbandsrechte, **sportliche Eingriffe aber nur mit Freigabe des Verbands** |

**Transparenz:** Jede Aktion mit Sonderrechten wird in einem Protokoll gespeichert (wer, was, wann, Begründung). Der Verband kann es einsehen. Weil Ratings aus Rohdaten reproduzierbar sind, fallen heimliche Änderungen beim Nachrechnen auf.

---

## 3. Accounts, Freischaltung, Ersteinstufung

- **Login:** Benutzername + Passwort, optional „Mit Google anmelden“. Eine E-Mail-Adresse ist optional. Ohne E-Mail gibt es kein „Passwort vergessen“, dann setzt der Admin bzw. Verband das Passwort zurück.
- **Alter:** Bei der Anmeldung eine Checkbox „Ich bin mindestens 16 Jahre alt“. Wer jünger ist, meldet sich beim Verband. Freischaltung im Einzelfall mit Einwilligung der Eltern.
- **Freischaltung:** Neue Accounts müssen freigeschaltet werden, von einem bestehenden Athleten, vom Verband oder vom Admin. Optional gibt es einen kurzen Fragebogen (z. B. seit wann Freestyle, Community/Ort).
- **Einladungsbaum:** Es wird gespeichert, wer wen freigeschaltet hat. Das hilft, Fake-Account-Ringe zu erkennen.
- **Ersteinstufung pro Format:** durch Admin, Verband oder mindestens 3 Athleten (Median), siehe Rating-Spezifikation Abschnitt 6. Die Erkennung von systematischer Über- und Unter-Einstufung pro Gruppe ist dort beschrieben.

---

## 4. Battle-Formate

- Formate sind **Datensätze, nicht Code**. Ein Format besteht aus einer Liste von **Teilen**. Jeder Teil hat eigene Regeln, z. B.:
  - „Best Trick“ (1 Trick)
  - „3-Trick-Kombo“ (feste Anzahl Tricks)
  - „10-Bounce-Kombo“ (feste Anzahl Bounces)
  - „Antwort“ (wiederhole den Gegner und häng etwas an – Hin-und-her-Formate)
- Ein Battle kann also aus mehreren Videos bestehen (z. B. Best Trick + 3-Trick-Kombo + 10-Bounce-Kombo) und auch aus mehreren Runden.
- Startformate: 3-Trick-Kombo, 10-Bounce-Kombo, Best Trick.
- **Beta-Formate:** Nutzer können Formate vorschlagen, die dann unter „Sonstiges“ als Status `fun` erscheinen. Ob ein Format Standard (`relevant`) wird, entscheidet der Verband bzw. Admin, optional nach einer Abstimmung.
- Ähnliche Formate können für das Rating zusammengelegt werden (`merged_into`, siehe Rating-Spezifikation Abschnitt 7).

---

## 5. Battle-Ablauf (online)

1. **Anfrage:** Ein Athlet stellt eine offene Anfrage für ein Format. Anderen werden passende Anfragen sortiert nach Elo-Nähe angezeigt, inklusive Wertung des Herausforderers. Annehmen oder ignorieren ist frei.
2. **Einstellungen** (der Herausforderer legt fest oder markiert sie als „flexibel“, dann einigen sich beide):
   - Format
   - Versuche pro Video: 1, 2, 3 oder unbegrenzt
   - Zeitfenster: fest oder flexibel
   - Gewichtung 1–5 (1 = Spaß … 5 = offizieller Wettkampf). Stufen 1–3 sind frei wählbar, 4–5 erst nach Freigabe durch Judge oder Orga.
   - Wertungsart: nur Sieg/Niederlage oder mit Deutlichkeit
   - Bewertungsmodus: Schnell (5er-Skala) oder Detailliert (Punktebogen, spätere Ausbaustufe)
3. **Aufnahme und Upload** (siehe Abschnitt 6). Mehrere Battles parallel sind möglich, auch mehrere gegen dieselbe Person.
4. **Freischaltung:** Die Videos beider Seiten werden erst sichtbar, wenn **beide** hochgeladen haben. Ausnahme sind Hin-und-her-Formate, dort sieht man das Video des Gegners vor der eigenen Antwort.
5. **Bewertung** (siehe Abschnitt 7).
6. **Sonderfälle:**
   - Wer im Zeitfenster nicht liefert, verliert. Der Gegner kann stattdessen „abgebrochen, ohne Wertung“ wählen.
   - Will eine Seite abbrechen, entscheidet die andere: als Sieg werten oder ohne Wertung abbrechen.
   - Kulanz: Der Gegner kann einen Extraversuch oder mehr Zeit gewähren (z. B. nach einem Verklicken, das man per Video zeigen kann).

---

## 6. Aufnahme

- **Aufnahme nur in der App**, kein Upload aus der Galerie.
- **Versuchslimit:** Der Start-Klick verbraucht einen Versuch. Die Aufnahme wird übernommen, man kann sie nicht verwerfen. Zielniveau „mittel-sicher“: Gelegenheits-Schummeln soll verhindert werden, eine wasserdichte Sperre ist nicht nötig.
- Beim Start wird ein Versuchsdatensatz mit Zeitstempel angelegt. Geprüft wird beim Upload. Optional kann ein Zufallscode oder die Uhrzeit ins Video eingeblendet werden.
- **Qualitätsstufen** wählt der Nutzer vor der Aufnahme: Datensparend / Normal / HD. Aufgenommen wird direkt in dieser Qualität, ohne nachträgliches Komprimieren auf dem Handy. Ein Hinweis erklärt, dass HD sich für Trainingsvideos lohnt.
- **Grob trimmen auf dem Handy:** Anfang und Ende markieren, z. B. ein Bounce vor dem Combo-Start und 1–2 Bounces danach. Geschnitten wird ohne Neu-Kodierung, das geht schnell. Der Rest wird nicht hochgeladen.
- **Schnittzeitpunkte:** Der Nutzer markiert (später mit Auto-Vorschlag) die einzelnen Bounces bzw. Tricks als Zeitstempel. Gespeichert wird ein Video plus Liste der Schnittzeitpunkte. Echte Einzelclips entstehen serverseitig (Abschnitt 10).
- **Offline:** Die App läuft offline (PWA). Videos werden lokal gespeichert und überstehen auch einen App-Absturz. Der Upload folgt automatisch, sobald Netz da ist und die App geöffnet wird. Auf dem iPhone gibt es keinen Hintergrund-Upload.
- **Filmen durch Freunde:** Jeder Athlet hat einen **festen Athleten-Code**, den er selbst ändern kann. Der Filmende öffnet die App (ein Account ist nicht nötig, die App muss aber einmal online geöffnet worden sein), gibt Code + Gegnernamen ein und filmt. Der Gegnername ist tolerant gegenüber Tippfehlern.
  - Das Video landet im **Eingang** des Athleten und wird beim Upload dem passenden Battle zugeordnet.
  - Der Gegner sieht den verwendeten Code bzw. Namen und die Aufnahmezeit.
  - Offen: Missbrauch durch nachträgliches Zuordnen bei mehreren offenen Battles (siehe Abschnitt 15).
- **Sichtbarkeit** wird pro Video beim Upload gewählt (siehe Abschnitt 12).

---

## 7. Bewertung

### 7.1 Stufe 1 – die beiden Athleten
- Beide bewerten getrennt mit der 5er-Skala: *A sicher besser · A eher besser · nicht zu entscheiden · B eher besser · B sicher besser*.
- Das Ergebnis wird erst sichtbar, wenn beide abgestimmt haben.
- **Einig** = beide auf derselben Seite. Dann ist das Battle entschieden.
- Uneinig oder neutral → Stufe 2.
- Unentschieden gibt es nur, wenn beide es bestätigen.

### 7.2 Stufe 2 – Athletenpool
- Bewerten dürfen Athleten mit ähnlichem oder leicht höherem Rating im Format, vorzugsweise etwas höher. Beteiligte sind ausgeschlossen.
- Offene Bewertungen erscheinen beim App-Start in einer Liste „Zu bewerten“.
- Es werden 3 Bewertungen gesammelt, ebenfalls mit der 5er-Skala.
- Bleibt ein Battle zu lange offen, wird der zugelassene Rating-Bereich schrittweise nach oben und unten erweitert.
- Sind sich alle einig → entschieden. Sonst → Stufe 3.

### 7.3 Stufe 3 – Judges
- Zertifizierte Judges entscheiden endgültig.

### 7.4 Detailmodus (spätere Ausbaustufe)
- Punktebogen pro Video: Tricks mit vorgeschlagenen Punkten aus der Trickliste (Grundtrick + Variation ± Ausführung) sowie subjektive Kategorien (Combo/Reihenfolge, Varianz, Style).
- Beide sehen die Bewertung der Gegenseite und die Unterschiede. Eine Formel berechnet daraus einen Vorschlag. Die 5er-Skala bleibt die abschließende Entscheidung.
- Bewertungsformel und Trickliste kommen von außen (paralleles Projekt eines anderen Entwicklers). Sie werden importiert und sind austauschbar (Abschnitt 9).

### 7.5 Übergabe an das Rating
- Nur Sieg/Niederlage: s = 1 / 0.
- Mit Deutlichkeit: s aus der 5er-Skala (1 · 0.75 · 0.5 · 0.25 · 0) oder aus Punkten (Rating-Spezifikation Abschnitt 3).
- Vorschlag für Stufe 1: s = Mittelwert der beiden (gespiegelten) Einschätzungen. Beispiel: „A sicher“ (1) und „A eher“ (0.75) ergeben s(A) = 0.875. Noch zu bestätigen.

---

## 8. Vor-Ort-Battles, Gruppenbattles, Competitions

- **Vor-Ort-Battle:** Nur das Ergebnis eintragen (optional mit Deutlichkeit und Video). Es gilt, wenn **beide bestätigen**. Gewichtung wie bei Online-Battles wählbar.
- **Gruppenbattle (n Personen):** wird in Paare zerlegt, jedes Paar zählt 1/(n−1) (Rating-Spezifikation Abschnitt 5.1).
- **Offizielle Competition:** Die Orga legt sie an und trägt Ergebnisse ein, entweder Einzel- bzw. Gruppenbattles (ggf. mit Punkten) oder nur Endplatzierungen. Einzelergebnisse haben Vorrang vor der Endplatzierung. Die Bestätigung erfolgt durch Verband oder Judge (Rating-Spezifikation Abschnitt 5.2).
- **Live-Übertragung** von Vor-Ort-Battles: Zukunftsidee (Abschnitt 14).

---

## 9. Trickliste und Videodatenbank (spätere Ausbaustufe)

- Die bestehende Trickliste wird **importiert** (kein eigenes Bewertungssystem). Der Austausch mit dem anderen Entwickler läuft zunächst manuell per Export/Import.
- **Feste Trick-IDs** und ein gemeinsames Austauschformat (z. B. JSON: ID, Name, Varianten, Punkte) früh mit dem anderen Entwickler abstimmen.
- Neue Tricks können Nutzer anlegen. Sie bekommen den Status „vorgeschlagen“, bis der Verband sie freigibt (Schutz vor Dubletten).
- **Tricks eintragen ist keine Pflicht**, wird aber stark motiviert. Eintragen können der Athlet selbst, der Gegner oder Freiwillige („Videos taggen“).
- Eingabe: Grundtrick per Autovervollständigung, Variation(en), Freitext-Kommentar.
- **Qualitätsbewertung pro Video** (Bildqualität, Blickwinkel, Eignung als Trainingsvideo) zum Filtern der Datenbank.
- Später: Clustern von Tricks (kraftbetont/technisch/Rotation) für bessere Combo-Wertung als Beta-Regelwerk. Außerdem KI-Trickerkennung per Körper-Tracking als Vorschlagsliste (Abschnitt 14).

---

## 10. Videospeicher, Verarbeitung, Archiv

- **Aktiver Speicher: Cloudflare R2.** Das Handy lädt direkt mit einer vom Server ausgestellten Upload-Erlaubnis hoch. Gratis sind 10 GB, danach 0,015 $/GB/Monat. Downloads sind kostenlos.
- **Verarbeitung** (zeitgesteuert per GitHub Actions, später ggf. Heimserver): Komprimieren nach Qualitätsstufe und Einstufung, Zerteilen in Einzelclips anhand der Schnittzeitpunkte, Löschen nicht mehr benötigter Rohdateien.
- **Archiv:** Videos werden nach X Wochen automatisch in einen **privaten Telegram-Kanal** verschoben (als Einzelclips, < 20 MB). Die Nachrichten-ID wird in der Datenbank gespeichert. Bei Bedarf werden sie zurück nach R2 geholt. Wird der Bot gesperrt, bleiben die Dateien im Kanal, und ein neuer Bot oder der eigene Account kommt wieder heran.
- **Zweite Kopie:** externe Festplatte (1–2 TB).
- **Speicherschicht austauschbar** halten (Interface), damit ein Anbieterwechsel möglich bleibt.
- **Löschungen müssen überall greifen:** R2, Telegram-Archiv und Festplatte.

---

## 11. Moderation, Abstimmungen, Protokoll

- **Melden-Knopf** für Videos, Battles und Profile. Meldungen landen bei Verband und Admin.
- **Annullieren:** Ein Battle wird auf „aberkannt“ gesetzt, danach wird das Rating neu berechnet (Replay). Folgeeffekte verschwinden damit ebenfalls, z. B. bei gepushten Fake-Accounts.
- **Strafen** durch den Verband (Art und Umfang offen).
- **Abstimmungsmodul** (allgemein): für Beta-Formate, Regeländerungen (z. B. Rating-Regel `CLAMP`) und Sonstiges. Das Ergebnis ist eine Empfehlung, die Entscheidung trifft Verband bzw. Admin.
- **Protokoll** aller Aktionen mit Sonderrechten (Abschnitt 2).

---

## 12. Datenschutz und Recht

- Die App wird weltweit genutzt. **Maßstab ist die DSGVO**, weil sie fast überall die strengste Regel ist.
- **Sichtbarkeit pro Video**, gewählt beim Upload:
  - **öffentlich** (Standard, mit Erklärung)
  - **nur eingeloggte Nutzer**
  - **nur zur Bewertung** (wird nach Abschluss der Bewertung gelöscht)
- **Account löschen:** Der Nutzer wählt, ob seine Videos bleiben oder gelöscht werden. Das Profil wird zu „gelöschter Nutzer“, Battle-Ergebnisse und Ratings der Gegner bleiben bestehen. Der Nutzer erhält einen **Löschlink** für spätere Löschwünsche.
- Mindestalter 16 per Selbstbestätigung, Ausnahmen im Einzelfall mit Einwilligung der Eltern. Erfährt man von Unter-16-Jährigen ohne Einwilligung, wird gesperrt bzw. gelöscht.
- Benötigt werden: Datenschutzerklärung (EN + DE), Impressum (Betrieb aus Deutschland), Nutzungsbedingungen. Erstellung in einem eigenen Chat, danach kurze Prüfung durch eine fachkundige Person.

---

## 13. Technik

| Baustein | Wahl |
|---|---|
| App | Progressive Web App (PWA), TypeScript, offlinefähig. Frontend-Framework wird beim Projektstart festgelegt (React wegen Verbreitung oder SvelteKit). |
| Hosting | Cloudflare Pages, zunächst kostenlose `*.pages.dev`-Adresse. Eigene Domain (~10 €/Jahr) erst bei Erfolg. |
| Server-Logik | Cloudflare Workers (Free: 100.000 Anfragen/Tag, reicht bis ca. 1000 täglich aktive Nutzer; danach Workers Paid 5 $/Monat) |
| Datenbank | Cloudflare D1 (SQLite, Free: 5 GB/Account) |
| Videos | Cloudflare R2, Archiv Telegram + Festplatte |
| Login | Auth-Bibliothek mit Benutzername/Passwort + Google OAuth |
| Benachrichtigungen | Web Push (iPhone: App muss auf dem Homescreen liegen) |
| Hintergrund-Jobs | GitHub Actions (Videoverarbeitung, Archivierung, vollständiger Rating-Replay) |
| Rating-Engine | Reines TypeScript-Modul ohne Datenbankzugriff, Unit-Tests gegen Rating-Spezifikation Abschnitt 11. `glicko_sim.py` bleibt Referenz. |
| Code | Öffentliches GitHub-Repo, Entwicklung mit Claude Code |
| Später optional | Android-APK via Capacitor (gleicher Code, kein Store). iPhone bleibt Web-App, kein App Store (99 $/Jahr). |

**Kosten:** Start 0 €. Später voraussichtlich wenige Euro im Monat (R2 über 10 GB, ggf. Workers Paid, Domain).

**Ergänzung zur Rating-Spezifikation (vorgemerkt für v1.1):** Personen, deren `RD_eff` die Obergrenze `RD_UNKNOWN` erreicht hat, werden in Ranglisten **ausgeblendet**. Die Wertung bleibt gespeichert und gilt bei Rückkehr sofort wieder. Für Personen mit wenigen Battles kann eine kürzere Frist gelten (Parameter).

---

## 14. Ausbaustufen

**Stufe 1 – Kern (MVP)**
- Accounts, Login, Freischaltung, Altersbestätigung
- Formate (vom Admin angelegt), Battle-Anfrage, Annahme, Einstellungen, Änderungsanträge
- In-App-Aufnahme mit Versuchslimit, Qualitätsstufen, grobes Trimmen, **Offline-Speicherung**
- Upload nach R2, Freischaltung nach beidseitigem Upload
- Bewertung Stufe 1 (5er-Skala)
- Rating-Engine (Glicko-2 nach Spezifikation), Format-Ranglisten
- Vor-Ort-Ergebnisse mit beidseitiger Bestätigung

**Stufe 2 – Wettkampfbetrieb**
- Filmen durch Freunde mit Athleten-Code, Eingang
- Bewertung Stufe 2 (Pool, „Zu bewerten“) und Stufe 3 (Judges)
- Rollen Judge, Orga, Verband, Protokoll, Melden, Annullieren
- Gruppenbattles, offizielle Competitions, Gewichtung 4–5 mit Freigabe
- Kombi-Rankings (offiziell + frei), Ersteinstufung durch Athleten, Über-Einstufungs-Warnung
- Push-Benachrichtigungen

**Stufe 3 – Datenbank und Community**
- Trickliste-Import, Trick-Taggen, Qualitätsbewertung, Detailmodus
- Schnittzeitpunkte, Zerteilen in Clips, Telegram-Archiv
- Beta-Formate, Abstimmungsmodul, mehrrundige und Hin-und-her-Formate

**Zukunft**
- KI-Trickerkennung (Körper-Tracking → Trick-Vorschläge)
- Auto-Schnitt am unteren Totpunkt
- Gesten-Start bei Dauerfilm (Session-Kamera)
- Live-Übertragung von Vor-Ort-Battles
- Android-APK

---

## 15. Offene Punkte

1. Stufe 1: Berechnung von s aus den zwei Einschätzungen (Vorschlag in 7.5) bestätigen.
2. Stufe 2: Was gilt bei 2:1 im Pool – Mehrheit oder Weitergabe an Judges? Wie lange bis zur Erweiterung des Rating-Bereichs?
3. Athleten-Code offline: Wie wird verhindert, dass Videos nachträglich dem „passenden“ Battle zugeordnet werden (Zuordnung vor der Aufnahme festlegen, Zeitstempel, Sichtbarkeit für den Gegner)?
4. Standardwerte: Zeitfenster, Versuche, Gewichtung.
5. Archivierung: nach wie vielen Wochen nach Telegram?
6. Video-Prototyp: Aufnahmequalität, Trimmen und Zerteilen auf echten iPhones und Androids testen.
7. Austauschformat Trickliste/Bewertungsformel mit dem anderen Entwickler.
8. Art und Umfang der Strafen durch den Verband.
9. Was passiert mit offenen Battles, wenn ein Account gelöscht wird?

---

## 16. Teilprojekte und Modell-Empfehlung

| Teilprojekt | Wo | Modell |
|---|---|---|
| Rating-System | eigener Chat (v1.0 erledigt) | Opus |
| Hauptentwicklung | Claude Code, öffentliches GitHub-Repo | Opus für Architektur und knifflige Teile, Sonnet für die Umsetzung |
| Video-Prototyp (Aufnahme, Trimmen, Offline) | Claude Code, eigener Branch oder Mini-Repo | Sonnet |
| Rechtstexte (Datenschutz, Impressum, Nutzungsbedingungen) | eigener Chat | Sonnet |
| Trickliste/Austauschformat | Abstimmung mit anderem Entwickler, ggf. eigener Chat | Sonnet |
| KI-Trickerkennung | später, eigener Chat bzw. Claude Code | Opus |
