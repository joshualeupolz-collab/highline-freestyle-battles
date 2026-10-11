# CLAUDE.md – Arbeitsanweisungen für dieses Repo

## Projekt in einem Satz

Kostenlose, offene Web-App für Highline-Freestyle-Battles mit Video-Aufnahme, gestufter Bewertung und
Glicko-2-Rating pro Format. Vollständiges Konzept: `docs/konzept.md`. Rating: `rating/rating-spezifikation.md`.

**Lies vor jeder größeren Aufgabe die relevanten Abschnitte dieser beiden Dokumente.** Sie sind die
verbindliche Grundlage. Weicht der Code davon ab, ist das ein Fehler – oder das Dokument muss in
Absprache angepasst werden.

## Arbeitsweise

- **Änderungsvorschläge erst bewerten, dann umsetzen.** Bei Änderungen am Konzept, an Regeln oder an der
  Architektur: Vorschlag und Bewertung (Aufwand, Risiken, Alternativen) vorlegen, auf Bestätigung warten.
  Offensichtliche Kleinigkeiten (Bugfixes, Tippfehler, klare Verbesserungen ohne Seiteneffekte) direkt umsetzen.
- **Ausbaustufen einhalten** (`docs/konzept.md` Abschnitt 14). Nicht vorgreifen, aber spätere Stufen beim
  Datenmodell mitdenken, damit kein Umbau nötig wird.
- **Kosten:** Betrieb muss im Gratis-Rahmen von Cloudflare/GitHub bleiben. Alles, was laufende Kosten
  verursachen könnte, vorher ansprechen.
- **Mitentwickler:** Code und Doku so schreiben, dass Fremde einsteigen können. Kommentare und Doku auf
  Deutsch, Bezeichner im Code auf Englisch.
- Teilaufgaben, die sich gut abtrennen lassen (z. B. Rechtstexte, Rating-Mathematik), lieber in eigene
  Chats/Sessions auslagern und darauf hinweisen.
- Dokumente nach Entscheidungen aktualisieren: Neue Entscheidungen kommen in `docs/konzept.md`,
  erledigte offene Punkte werden dort aus Abschnitt 15 entfernt.

## Technik-Stack

| Bereich | Wahl |
|---|---|
| Sprache | TypeScript (strict) |
| App | PWA, offlinefähig (Service Worker, IndexedDB für Videos) |
| Hosting | Cloudflare Pages (`*.pages.dev`) |
| API | Cloudflare Workers |
| Datenbank | Cloudflare D1 (SQLite), Migrationen versioniert im Repo |
| Videos | Cloudflare R2, Upload direkt vom Handy per signierter URL |
| Hintergrund-Jobs | GitHub Actions (Videoverarbeitung, Archivierung, Rating-Replay) |
| Tests | Vitest |

Gratis-Limits beachten: Workers Free = 100.000 Anfragen/Tag und sehr wenig CPU-Zeit pro Anfrage →
nichts Rechenintensives im Worker (kein Video, kein kompletter Rating-Replay). D1 Free = 5 Mio.
gelesene / 100.000 geschriebene Zeilen pro Tag → Indizes setzen, keine Full-Table-Scans.

## Architektur-Regeln

1. **Rohdaten sind die Wahrheit.** Battles, Ergebnisse, Einstufungen und Regelversionen werden
   gespeichert; Ratings sind abgeleitet und jederzeit per Replay reproduzierbar.
2. **Regeln sind Daten.** Formate, Rating-Parameter (`RuleSet`), später Trickliste und Bewertungsformel
   sind versionierte Datensätze, nicht hart codiert. Jedes Battle speichert die verwendete Version.
3. **Rating-Engine** (`packages/rating` o. ä.): reines Modul ohne Datenbank- oder Netzwerkzugriff.
   Eingabe: Events, Einschätzungen, RuleSet. Ausgabe: RatingState, RatingHistory. Unit-Tests gegen
   `rating/rating-spezifikation.md` Abschnitt 11. `rating/glicko_sim.py` ist die Referenz – Ergebnisse
   müssen auf ±1 Punkt übereinstimmen.
4. **Speicherschicht austauschbar** (Interface für Videospeicher: R2, später Telegram-Archiv).
5. **Rechte zentral prüfen.** Rollen: Gast, Athlet, Judge, Orga, Verband, Admin. Befangenheitsregel:
   Niemand entscheidet in einer Sonderrolle über eigene Battles. Sportliche Eingriffe des Admins nur mit
   Verbandsfreigabe. Jede Aktion mit Sonderrechten ins Protokoll.
6. **Datenschutz:** DSGVO als Maßstab. Sichtbarkeit pro Video (öffentlich / eingeloggt / nur Bewertung),
   Löschungen müssen in allen Speichern greifen. Keine Geheimnisse (API-Keys, Tokens) ins Repo – nur über
   Cloudflare-/GitHub-Secrets.

## Repo-Struktur (Zielbild, wird beim Start angelegt)

```
docs/          Konzept und weitere Doku
rating/        Rating-Spezifikation und Python-Referenz
apps/web/      PWA (Frontend)
apps/api/      Cloudflare Worker (API)
packages/rating/  Rating-Engine (TypeScript, rein)
db/migrations/ D1-Migrationen
.github/workflows/  CI und Hintergrund-Jobs
```
