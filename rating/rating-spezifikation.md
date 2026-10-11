# Rating-System – Spezifikation (v1.0)

Highline-Freestyle-Battle-App · Stand 2026-10-11
Referenz-Implementierung: `glicko_sim.py` (Glicko-2-Kern, Simulation, Testwerte)

---

## 0. Grundprinzipien

1. **Glicko-2** pro Battle-Format. Jede Person hat pro Format eine Wertung `r`, eine Unsicherheit `RD` und eine Volatilität `σ`.
2. **Es gibt kein eigenes Gesamt-Rating.** Gesamtranglisten (Kombi-Rankings) werden immer aus den Format-Ratings berechnet.
3. **Rohdaten sind die Wahrheit, Ratings sind abgeleitet.** Gespeichert werden Battles, Einstufungen und Regelversionen. Ratings lassen sich jederzeit durch Neuberechnung der gesamten Historie (Replay) reproduzieren.
4. **Alle Zahlen dieses Dokuments sind Parameter** in einem versionierten Regelwerk (`RuleSet`). Regeländerungen, z. B. nach einer Community-Umfrage, erzeugen eine neue Version. Danach werden die Ratings entweder ab sofort mit der neuen Version weitergerechnet oder komplett neu berechnet (Admin-Entscheidung).

---

## 1. Parameter (Startwerte)

| Parameter | Wert | Bedeutung |
|---|---|---|
| `R_DEFAULT` | 1500 | Wertung ohne jede Einstufung |
| `SCALE` | 173.7178 | Glicko-2-Umrechnung, fest |
| `TAU` | 0.5 | Systemkonstante Volatilität |
| `SIGMA_START` | 0.06 | Start-Volatilität |
| `RD_UNKNOWN` | 350 | Unsicherheit ohne Einstufung, zugleich Obergrenze |
| `RD_START` | 200 | Unsicherheit nach Ersteinstufung |
| `GRACE_DAYS` | 30 | Karenzzeit ohne Inaktivitätseffekt |
| `C_INACT` | 0.94 | Wachstumsrate der Unsicherheit bei Inaktivität |
| `K_DISPLAY` | 2.0 | Ranking-Wert = r − 2·RD |
| `PROVISIONAL_RD` | 110 | darüber gilt ein Rating als vorläufig („?“) |
| `MIN_BATTLES` | 5 | darunter gilt ein Rating als vorläufig („?“) |
| `WEIGHT` | 1→0.25, 2→0.5, 3→1, 4→1.5, 5→2 | Gewichtungsstufen |
| `K_POINTS` | 2.0 (pro Format änderbar) | Punkte → Score |
| `CLAMP` | `winner` | Sieger verliert nie (Alternative: `both`, `none`) |
| `COMBO_MISSING_Z` | −1.0 | Wert eines fehlenden Formats im Kombi-Ranking |
| `COMBO_MIN_POP` | 10 | Mindestzahl etablierter Personen für eigene Streuung |
| `COMBO_FALLBACK_SD` | 250 | Ersatz-Streuung bei kleinen Formaten |
| `OVERRATE_Z` | −3.0 | Schwelle für die Warnung „Über-Einstufung“ |

---

## 2. Glicko-2-Kern

Umrechnung: `μ = (r − 1500)/SCALE`, `φ = RD/SCALE`.

Für Person A mit den Vergleichen j = 1..m (Gegner `μj`, `φj`, Score `sj ∈ [0,1]`, Gewicht `wj`):

```
g(φ)  = 1 / sqrt(1 + 3φ²/π²)
Ej    = 1 / (1 + exp(−g(φj)·(μ − μj)))
v     = 1 / Σ wj · g(φj)² · Ej · (1 − Ej)
Δ     = v · Σ wj · g(φj) · (sj − Ej)
σ'    = Volatilitäts-Iteration nach Glickman (Illinois-Verfahren, ε = 1e-6), siehe Referenzcode new_sigma()
φ*    = sqrt(φ² + σ'²)
φ'    = 1 / sqrt(1/φ*² + 1/v)
μ'    = μ + φ'² · Σ wj · g(φj) · (sj − Ej)
```

Zurückrechnen: `r' = 1500 + SCALE·μ'`, `RD' = SCALE·φ'`.

Das Gewicht `wj` ist die einzige Abweichung vom Original. Ein Battle mit Gewicht 2 zählt wie zwei identische Battles. Dies ersetzt den K-Faktor aus dem klassischen Elo.

### 2.1 Sofortige Aktualisierung

Es gibt keine Rating-Perioden. Jedes **Event** wird sofort verarbeitet. Ein Event ist ein Einzelbattle, ein Gruppenbattle oder ein Competition-Ergebnis.

- Alle Beteiligten eines Events werden **gleichzeitig** aktualisiert. Dabei werden immer die Werte von vor dem Event verwendet.
- Reihenfolge beim Replay: nach Event-Zeitstempel, bei Gleichstand nach ID. Das Ergebnis muss deterministisch sein.

### 2.2 Inaktivität (vor jeder Berechnung und für jede Anzeige)

```
t      = Tage seit letztem Battle in diesem Format
RD_eff = min(RD_UNKNOWN, sqrt(RD² + (C_INACT · max(0, t − GRACE_DAYS))²))
```

- `RD_eff` wird beim nächsten Update als Ausgangs-RD verwendet und in jeder Rangliste angezeigt.
- Die **Wertung r ändert sich durch Inaktivität nie.** Es werden keine Punkte vernichtet oder umverteilt. Das verhindert Inflation und Deflation.

Effekt im Ranking (vorher RD 50):

| Tage inaktiv | 30 | 60 | 90 | 120 | 180 | 270 | 365 | ≥ ~500 |
|---|---|---|---|---|---|---|---|---|
| RD | 50 | 57 | 75 | 98 | 150 | 231 | 319 | 350 |
| Abzug im Ranking | 0 | −15 | −51 | −97 | −199 | −362 | −538 | −600 |

### 2.3 Schutzregel „Sieger verliert nie“ (`CLAMP`)

Für jede Person in einem Event wird zuerst das Ergebnis bestimmt: `outcome = Σ wj·(sj − 0.5)`.

- `CLAMP = winner`: Ist `outcome > 0` und die neue Wertung kleiner als die alte, dann bleibt die alte Wertung. RD und σ werden trotzdem normal aktualisiert.
- `CLAMP = both`: Zusätzlich gilt: Ist `outcome < 0` und die neue Wertung größer als die alte, dann bleibt die alte Wertung.
- Bekannter Nebeneffekt von `winner`: Es entsteht eine leichte Punktezunahme. In der Simulation waren das etwa +7 Punkte in 2 Jahren. Siehe Abschnitt 9.
- Die Variante `both` soll per Community-Umfrage entschieden werden können. Dafür reicht ein Wechsel der RuleSet-Version.

---

## 3. Ergebnis eines Battles (Score s)

Pro Battle wird eine Ergebnisart gewählt:

| Art | Score für Person A |
|---|---|
| Nur Sieg/Niederlage | 1 / 0 |
| 5er-Skala | 1 · 0.75 · 0.5 · 0.25 · 0 |
| Punkte a : b | `s = a^k / (a^k + b^k)`, k = `K_POINTS` des Formats. Sind beide 0, gilt s = 0.5 |
| Unentschieden | 0.5, **nur wenn beide Seiten bestätigen** |

Der Score für Person B ist immer `1 − s`.

Beispiele mit k = 2: 100:90 → 0.55 · 150:80 → 0.78 · 200:50 → 0.94 · 120:0 → 1.0

---

## 4. Gewichtung 1–5

| Stufe | Faktor | Wer darf die Stufe wählen? |
|---|---|---|
| 1 Spaß | 0.25 | alle |
| 2 | 0.5 | alle |
| 3 normal | 1.0 | alle |
| 4 | 1.5 | nur mit Freigabe (Judge/Orga) |
| 5 offizieller Wettkampf | 2.0 | nur mit Freigabe (Judge/Orga) |

**Entschieden:** Battles mit Stufe 4–5 zählen erst nach der Freigabe. Bis dahin fließen sie gar nicht ins Rating ein (Status `pending`). Mit der Freigabe wird das Event zum Zeitpunkt seines Battle-Zeitstempels eingeordnet. Liegt es zeitlich vor bereits verarbeiteten Events, wird ab diesem Zeitpunkt neu berechnet (Replay).

---

## 5. Gruppenbattles und Competitions

### 5.1 Gruppenbattle mit n Personen

- Das Battle wird in alle Paare zerlegt. Jedes Paar wird mit dem Gewicht `WEIGHT[Stufe] / (n − 1)` gewertet.
- Score pro Paar: aus der Platzierung (besser = 1, gleich = 0.5) oder aus den Punkten (Formel aus Abschnitt 3).
- Alle Paare zusammen bilden **ein** Event mit gleichzeitiger Aktualisierung.
- Effekt: Jede Person bekommt insgesamt genau das Gewicht eines einzelnen Battles der gewählten Stufe.

### 5.2 Offizielle Competition

- Liegen für eine Competition in einem Format **Einzel- oder Gruppenergebnisse** vor, werden **nur diese** gewertet. Die Endplatzierung wird dann für die Wertung ignoriert. So wird nichts doppelt gezählt.
- Liegt **nur die Endplatzierung** vor, wird sie wie ein Gruppenbattle mit allen Teilnehmenden behandelt. Stufe in der Regel 5, also Gewicht pro Paar `2/(n−1)`.
- Gleiche Plätze werden als Unentschieden gewertet (0.5).

---

## 6. Ersteinstufung und Erkennung von Über-Einstufung

### 6.1 Startwert

| Situation | Start-Wertung | Start-RD |
|---|---|---|
| keine Einstufung | 1500 | 350 |
| Admin-Einstufung | angegebener Wert | 200 |
| Einstufung durch Nutzer (≥ 3 Einschätzungen) | Median der Einschätzungen | 200 |

- Jede Einschätzung wird als Datensatz gespeichert: wer hat wen, in welchem Format, mit welchem Wert, wann eingestuft.
- Eine Einstufung ist nur möglich, solange die Person in diesem Format weniger als `MIN_BATTLES` Battles hat.

### 6.2 Über-Einstufung erkennen

Für jede eingestufte Person in einem Format mit mindestens 10 Battles werden zwei Werte berechnet:
- `drift = r (nach 10 Battles) − Startwert`
- `residual = Σ w·(s − E) / Σ w` über die ersten 10 Battles

Danach wird pro Gruppe ausgewertet. Gruppen können sein: eine einstufende Person, eine Region oder Community-Tag.

```
z = mean(drift) / (sd(drift) / sqrt(n))     (n ≥ 5)
```

- `z < OVERRATE_Z (−3)`: Warnung an den Admin „Diese Gruppe stuft systematisch zu hoch ein“, mit Anzeige der mittleren Abweichung.
- `z > +3`: entsprechend „stuft systematisch zu niedrig ein“.
- Optional für später: Neue Einschätzungen dieser Gruppe automatisch um die mittlere Abweichung korrigieren.

In der Simulation wurde eine Gruppe, die um 250 Punkte zu hoch eingestuft war, zuverlässig erkannt (z zwischen −5 und −9).

---

## 7. Formate

- Format-Felder: `name`, `status` (`relevant` | `fun`), `k_points`, `merged_into` (optional).
- Neue Formate können von Nutzern vorgeschlagen werden. Sie starten mit Status `fun`. Ein Admin kann sie auf `relevant` hochstufen.
- **Zusammenlegen:** Das Format B wird per `merged_into = A` mit A verbunden. Danach zählen alle Battles von B als Battles von A, und es folgt ein Replay. Das ist umkehrbar, weil die Rohdaten unverändert bleiben.
- Ratings werden für alle Formate berechnet, unabhängig vom Status. Der Status bestimmt nur, ob ein Format in offiziellen Kombi-Rankings vorkommen darf.

---

## 8. Ranglisten

### 8.1 Format-Rangliste

- Sortierung nach `R = r − K_DISPLAY · RD_eff`.
- Anzeige: Wertung, ± RD und „?“, wenn `RD_eff > PROVISIONAL_RD` oder Battles < `MIN_BATTLES`.
- Vorläufige Ratings werden angezeigt, aber nicht ausgeblendet.

### 8.2 Kombi-Ranking

Ein Kombi-Ranking ist eine gespeicherte Konfiguration:

```
{ formate: [...], streiche_schlechteste: X, fehlend_z: -1.0, offiziell: true/false }
```

Berechnung zu einem Zeitpunkt:
1. **Normierung pro Format:**
   - Die Grundmenge sind alle nicht-vorläufigen Personen des Formats.
   - Daraus werden Mittelwert `m_f` und Streuung `sd_f` von R berechnet.
   - Bei weniger als `COMBO_MIN_POP` Personen gilt `sd_f = COMBO_FALLBACK_SD`, und `m_f` ist der Mittelwert aller vorhandenen Personen.
2. **Pro Person und Format:** `z_f = (R_f − m_f) / sd_f`. Hat die Person das Format nie gespielt, gilt `z_f = fehlend_z`.
3. Die **X schlechtesten** z-Werte werden gestrichen.
4. **Kombi-Wert** = Mittelwert der verbleibenden z-Werte.
5. Die Person erscheint nur, wenn sie mindestens 1 echtes Format in der Auswahl hat.

Rechenbeispiel mit 3 Formaten:

| Athlet | z pro Format | X=0 | X=1 | X=2 |
|---|---|---|---|---|
| Anna (Allrounderin) | 1.12 / 1.05 / 0.97 | 1.05 | 1.09 | 1.12 |
| Ben (nur ein Format) | – / – / 2.77 | 0.26 | 0.89 | 2.77 |
| Carla (zwei Formate) | 1.52 / 1.90 / – | 0.81 | 1.71 | 1.90 |
| David (nach Pause) | 1.36 / 1.20 / 1.30 | 1.29 | 1.33 | 1.36 |
| Emil (Neuling) | −0.40 / −1.00 / −0.50 | −0.63 | −0.45 | −0.40 |

**Offizielle Rangliste:**
- Eine vom Admin gesperrte Konfiguration, z. B. „alle relevanten Formate, schlechteste 2 gestrichen“.
- Sie darf nur Formate mit Status `relevant` enthalten.

**Freie Ranglisten:**
- Jede Person kann Formate und X per Filter frei wählen, z. B. für eine Competition mit 4 Formaten.
- Freie Ranglisten werden nicht gespeichert, außer man will sie teilen.

---

## 9. Inflation und Deflation

- Der Glicko-2-Kern ist nicht exakt nullsummig, erzeugt aber selbst keine systematische Drift.
- In der Simulation (120 Personen, 3 Formate, 2 Jahre, 3 Durchläufe) stieg der Mittelwert der Wertungen um etwa 15–25 Punkte pro Jahr. Ursachen:
  1. zu hoch eingestufte Personen geben ihre überschüssigen Punkte an ihre Gegner ab,
  2. die Regel „Sieger verliert nie“.
- **Auswirkung:** Die Reihenfolge in den Ranglisten bleibt davon unberührt. Kombi-Rankings nutzen z-Werte und sind deshalb ebenfalls immun. Betroffen sind nur die absoluten Zahlen über lange Zeiträume.
- **Maßnahme:**
  - Der Admin sieht im Dashboard den Mittelwert der etablierten, aktiven Personen pro Format.
  - Optional (Parameter `ANCHOR`, Standard aus): Einmal im Jahr werden alle Wertungen eines Formats um denselben Betrag verschoben, sodass dieser Mittelwert wieder auf den Zielwert kommt. Die Reihenfolge ändert sich dadurch nicht.

---

## 10. Datenmodell (Mindestumfang)

```
Format(id, name, status, k_points, merged_into, created_by, created_at)
Event(id, format_id, kind: single|group|competition_placement, level 1–5,
      approved_by?, competition_id?, timestamp, status: pending|confirmed|rejected)
EventResult(event_id, person_id, points?, placement?, scale_value?)   -- Rohdaten
DrawConfirmation(event_id, person_id)
Estimate(id, subject_id, estimator_id, format_id, value, timestamp)
RuleSet(version, parameter-JSON, valid_from, note)
RatingState(person_id, format_id, r, rd, sigma, last_battle_at, n_battles, ruleset_version)  -- abgeleitet, Cache
RatingHistory(event_id, person_id, format_id, r_before, r_after, rd_before, rd_after)        -- für Anzeige „+12“
ComboConfig(id, name, format_ids, drop_worst, missing_z, official, locked_by)
```

`RatingState` und `RatingHistory` lassen sich jederzeit vollständig aus `Event`, `EventResult`, `Estimate` und `RuleSet` neu erzeugen.

---

## 11. Testwerte für die Implementierung

Parameter: σ = 0.06, τ = 0.5, Gewicht 1, keine Schutzregel. Die Werte müssen auf ±1 Punkt reproduziert werden.

| A (r±RD) | B (r±RD) | s(A) | Δr A | RD A neu | Δr B |
|---|---|---|---|---|---|
| 1600±60 | 1500±60 | 1 | +7 | 60 | −7 |
| 1600±60 | 1500±60 | 0 | −13 | 60 | +13 |
| 1600±200 | 1500±60 | 1 | +63 | 176 | −7 |
| 3000±50 | 2000±50 | 0 | −15 | 51 | +15 |
| 3000±176 | 2000±50 | 0 | −176 | 176 | +13 |
| 3000±176 | 2000±50 | 1 | +1 | 176 | 0 |
| 3000±176 | 2000±50 | 0.25 | −132 | 176 | +10 |

Gewichte bei 1600±60 schlägt 1500±60: Gewicht 0.25 → +2, Gewicht 1 → +7, Gewicht 2 → +14.

Inaktivität: RD vorher 50, 210 Tage inaktiv → RD_eff = 176.

---

## 12. Erklärung für Athleten (Kurzfassung)

- Du hast pro Format eine **Wertung** und eine **Unsicherheit**. Neu, lange nicht gebattlet oder wenige Battles bedeutet: hohe Unsicherheit und ein „?“ hinter dem Rating.
- Gewinnst du gegen jemanden, der stärker eingeschätzt wird, bekommst du viele Punkte. Gegen schwächer Eingeschätzte bekommst du wenige.
- Je deutlicher du gewinnst und je höher die Battle-Stufe ist, desto mehr zählt das Battle.
- **Wer gewinnt, verliert nie Punkte.** Wer knapp gegen jemand deutlich Besseren verliert, kann trotzdem Punkte bekommen.
- Wer pausiert, behält seine Punkte. In der Rangliste rutscht man aber langsam nach unten, weil das System nicht mehr sicher ist, wie stark man aktuell ist. Ein paar Battles nach der Rückkehr reichen, um wieder einzusteigen.
- Gesamtranglisten werden aus deinen Format-Ratings berechnet. Deine schwächsten Formate werden je nach Rangliste gestrichen.

---

## 13. Entscheidungslog und Schnittstellen zu anderen Teilprojekten

**Entschieden (Chat „Rating-System“, 2026-10-11):**
- Glicko-2 pro Format, mit sofortiger Aktualisierung nach jedem Event. Es gibt kein eigenes Gesamt-Elo.
- Battle-Gewichtung über einen Gewichtsfaktor pro Battle statt K-Faktor. Stufe 4–5 erst nach Freigabe.
- Die Deutlichkeit ist pro Battle wählbar. Für Punkte gilt die Formel mit k = 2, der Wert ist pro Format änderbar.
- „Sieger verliert nie“ ist aktiv. „Verlierer gewinnt nie“ ist aktuell **nicht** aktiv und soll per Community-Umfrage entschieden werden können.
- Inaktivität wirkt nur über steigende Unsicherheit. Die Rangliste sortiert nach r − 2·RD.
- Kombi-Rankings basieren auf z-Werten. Die schlechtesten X Formate werden gestrichen, ein fehlendes Format zählt als −1. Es gibt eine offizielle, gesperrte Konfiguration und frei filterbare Varianten.
- Formate haben den Status `relevant` oder `fun`. Ähnliche Formate können über `merged_into` zusammengelegt werden.

**Benötigt von anderen Teilprojekten (App, Backend, UI):**
- Ein Umfrage-Feature für Regeländerungen, mit einer neuen RuleSet-Version als Ergebnis.
- Ein Freigabe-Workflow für Stufe 4–5 durch Judges/Orga.
- Ein Bestätigungs-Workflow für Ergebnisse und Unentschieden. Beide Seiten müssen bestätigen.
- Ein Admin-Dashboard mit Warnungen zu Über- und Unter-Einstufung und dem Mittelwert pro Format (Inflationskontrolle).
- Eine Ersteinstufungs-Oberfläche für Admin und Nutzer.

**Umsetzungshinweis für Claude Code:**
- Die Rating-Engine soll ein eigenständiges, reines Modul ohne Datenbankzugriff sein. Eingabe sind Events, Einschätzungen und ein RuleSet, Ausgabe sind RatingState und RatingHistory.
- Unit-Tests gegen die Werte aus Abschnitt 11 schreiben.
- `glicko_sim.py` ist die Referenz. Neue Implementierungen müssen dieselben Zahlen liefern.
