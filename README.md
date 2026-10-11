# Highline Freestyle Battles

Eine kostenlose, offene Web-App für Highline-Freestyle-Battles – ähnlich wie Online-Schach:
Athleten fordern sich weltweit heraus, filmen ihre Runs in der App, bewerten sich gegenseitig
und sammeln ein Rating pro Battle-Format.

> **Status:** Konzeptphase – noch kein App-Code. Die Planung steht, die Umsetzung startet mit Ausbaustufe 1.

## Kernideen

- **Battles per Video** – offene Anfragen nach Rating-Nähe, Aufnahme direkt in der App mit Versuchslimit, offlinefähig
- **Gestufte Bewertung** – erst die beiden Athleten, bei Uneinigkeit ein Athletenpool, zuletzt zertifizierte Judges
- **Rating pro Format** – gewichtetes Glicko-2 mit Unsicherheit („?“), Inaktivität lässt im Ranking abrutschen, ohne Punkte zu vernichten
- **Kombi-Rankings** – frei zusammenstellbar aus beliebigen Formaten, z. B. für eine konkrete Competition
- **Vor-Ort-Battles, Gruppenbattles, offizielle Competitions** – alles fließt ins selbe Rating
- **Vertrauensbasis** – die Community kennt sich; alles ist änderbar, wenn beide Seiten zustimmen

## Dokumente

| Datei | Inhalt |
|---|---|
| [`docs/konzept.md`](docs/konzept.md) | Gesamtkonzept: Rollen, Battle-Ablauf, Aufnahme, Bewertung, Speicher, Datenschutz, Technik, Ausbaustufen, offene Punkte |
| [`rating/rating-spezifikation.md`](rating/rating-spezifikation.md) | Rating-System (Glicko-2-Variante): Formeln, Parameter, Testwerte |
| [`rating/glicko_sim.py`](rating/glicko_sim.py) | Referenz-Implementierung und Simulation des Rating-Systems |
| [`CLAUDE.md`](CLAUDE.md) | Arbeitsanweisungen für die Entwicklung mit Claude Code |

## Technik (geplant)

PWA in TypeScript · Cloudflare Pages + Workers + D1 + R2 · GitHub Actions für Hintergrund-Jobs ·
Betriebskosten zum Start 0 €.

Referenz-Simulation ausprobieren:

```bash
pip install numpy
python rating/glicko_sim.py beispiele
```

## Mitmachen

Das Projekt ist Open Source und freut sich über Mitentwickler. Bitte zuerst `docs/konzept.md` und
`CLAUDE.md` lesen. Größere Änderungen am Konzept oder an den Regeln bitte vorher als Issue zur
Diskussion stellen.

## Lizenz

[MIT](LICENSE)
