# Highline Freestyle Battles

A free, open web app for highline freestyle battles – similar to online chess:
athletes challenge each other worldwide, film their runs in the app, review each other
and build up a rating per battle format.

> **Status:** concept phase – no app code yet. Planning is done; implementation starts with stage 1.

## Key ideas

- **Battles by video** – open requests matched by rating, recording directly in the app with an attempt limit, works offline
- **Tiered review** – first the two athletes, then a pool of athletes if they disagree, finally certified judges
- **Rating per format** – weighted Glicko-2 with uncertainty ("?"); inactivity lowers your ranking without destroying points
- **Combined rankings** – freely assembled from any formats, e.g. for a specific competition
- **On-site battles, group battles, official competitions** – all feed into the same rating
- **Built on trust** – the community knows each other; anything can be changed if both sides agree

## Documents

| File | Contents |
|---|---|
| [`docs/concept.md`](docs/concept.md) | Overall concept: roles, battle flow, recording, review, storage, privacy, technology, development stages, open questions |
| [`rating/rating-specification.md`](rating/rating-specification.md) | Rating system (Glicko-2 variant): formulas, parameters, test values |
| [`rating/glicko_sim.py`](rating/glicko_sim.py) | Reference implementation and simulation of the rating system |
| [`CLAUDE.md`](CLAUDE.md) | Working instructions for development with Claude Code |

## Technology (planned)

PWA in TypeScript · Cloudflare Pages + Workers + D1 + R2 · GitHub Actions for background jobs ·
running costs at launch: €0.

Try the reference simulation:

```bash
pip install numpy
python rating/glicko_sim.py examples
```

## Contributing

This is an open-source project and contributors are welcome. Please read `docs/concept.md` and
`CLAUDE.md` first. Please open an issue to discuss larger changes to the concept or the rules
before implementing them.

## License

[MIT](LICENSE)
