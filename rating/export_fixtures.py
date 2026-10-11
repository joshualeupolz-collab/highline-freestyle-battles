"""
Exports reference fixtures for the TypeScript rating engine (packages/rating).

The Glicko-2 maths (update, volatility, inactivity, protection rule, points -> score) come
unchanged from glicko_sim.py, the reference. This script only adds the event handling of the
rating specification (immediate updates, groups split into pairs, initial estimates, merged
formats) and replays a random but seeded history. The TypeScript engine must reproduce every
number within the tolerance of its tests.

Usage:
  python rating/export_fixtures.py     -> writes packages/rating/test/fixtures/*.json
"""
import json
import os
import random
import statistics
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import glicko_sim as gs  # noqa: E402

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "packages", "rating", "test", "fixtures")
DAY_MS = 86_400_000
START_MS = 1_767_225_600_000  # 2026-01-01T00:00:00Z

R_DEFAULT = 1500
FORMATS = [
    {"id": "f-combo", "kPoints": None, "mergedInto": None},
    {"id": "f-bounce", "kPoints": 1.5, "mergedInto": None},
    {"id": "f-best", "kPoints": None, "mergedInto": None},
    {"id": "f-best-old", "kPoints": 3.0, "mergedInto": "f-best"},  # merged: counts as f-best
]
PARAMS = {
    "rDefault": R_DEFAULT,
    "scale": gs.SCALE,
    "tau": gs.TAU,
    "sigmaStart": gs.SIGMA_START,
    "rdUnknown": gs.RD_MAX,
    "rdStart": gs.RD_START,
    "graceDays": gs.GRACE_DAYS,
    "cInact": gs.C_INACT,
    "kDisplay": gs.K_DISPLAY,
    "provisionalRd": gs.PROVISIONAL_RD,
    "minBattles": gs.MIN_GAMES_ESTABLISHED,
    "weights": {str(k): v for k, v in gs.WEIGHT.items()},
    "kPoints": gs.K_POINTS,
}


def rating_format(fid):
    by_id = {f["id"]: f for f in FORMATS}
    while by_id.get(fid, {}).get("mergedInto"):
        fid = by_id[fid]["mergedInto"]
    return fid


def k_points(fid):
    k = next((f["kPoints"] for f in FORMATS if f["id"] == fid), None)
    return gs.K_POINTS if k is None else k


# ============================ scenario generator ============================
def generate(seed, n_people, n_events):
    rng = random.Random(seed)
    people = [f"p{i:02d}" for i in range(n_people)]
    strength = {p: rng.gauss(1600, 300) for p in people}
    # some people take a long break (inactivity)
    breaks = {p: (rng.randint(60, 400), rng.randint(90, 250)) for p in rng.sample(people, n_people // 4)}

    events, t = [], START_MS
    for i in range(n_events):
        if rng.random() > 0.15:  # 15 % share a timestamp with the previous event (tie-break by id)
            t += rng.randint(1, 3 * DAY_MS)
        day = (t - START_MS) / DAY_MS
        active = [p for p in people if not (p in breaks and breaks[p][0] <= day < breaks[p][0] + breaks[p][1])]
        fid = rng.choice(["f-combo", "f-combo", "f-bounce", "f-best", "f-best-old"])
        kind = rng.random()
        level = rng.choices([1, 2, 3, 4, 5], weights=[25, 25, 35, 10, 5])[0]
        perf = lambda p: strength[p] + rng.gauss(0, 200)  # noqa: E731

        if kind < 0.6:
            a, b = rng.sample(active, 2)
            mode = rng.random()
            if mode < 0.4:
                scoring = "score"
                pa, pb = perf(a), perf(b)
                s = rng.choice([1.0, 0.75, 0.5, 0.25, 0.0]) if mode < 0.2 else (1.0 if pa > pb else 0.0)
                parts = [{"personId": a, "score": s}, {"personId": b, "score": 1 - s}]
                if rng.random() < 0.5:
                    del parts[1]["score"]  # the second score is optional
            elif mode < 0.8:
                scoring = "points"
                parts = [{"personId": p, "points": max(0, round(perf(p) / 10))} for p in (a, b)]
                if rng.random() < 0.05:
                    for p in parts:
                        p["points"] = 0
            else:
                scoring = "placement"
                parts = [{"personId": a, "placement": 1}, {"personId": b, "placement": rng.choice([1, 2])}]
        else:
            n = rng.randint(3, 6) if kind < 0.9 else rng.randint(6, 12)
            if kind >= 0.9:
                level = 5  # competition placement
            group = rng.sample(active, n)
            if rng.random() < 0.6:
                scoring = "placement"
                ranked = sorted(group, key=perf, reverse=True)
                place, parts = 0, []
                for idx, p in enumerate(ranked):
                    if idx == 0 or rng.random() > 0.15:  # 15 % tie with the person before
                        place = idx + 1
                    parts.append({"personId": p, "placement": place})
                rng.shuffle(parts)
            else:
                scoring = "points"
                parts = [{"personId": p, "points": max(0, round(perf(p) / 10))} for p in group]
        events.append({
            "id": f"e{i:04d}", "formatId": fid, "timestamp": t, "level": level,
            "rulesetVersion": 1, "scoring": scoring, "participants": parts,
        })

    estimates = []
    for p in rng.sample(people, n_people // 3):  # admin estimates, mostly before the first battle
        estimates.append({
            "subjectId": p, "estimatorId": "admin", "formatId": rng.choice(["f-combo", "f-best-old"]),
            "kind": rng.choice(["admin", "federation"]), "value": round(strength[p] + rng.gauss(0, 150)),
            "timestamp": START_MS + rng.randint(-30, 120) * DAY_MS,
        })
    for p in rng.sample(people, n_people // 3):  # athlete estimates: some groups too small (< 3)
        estimators = rng.sample([q for q in people if q != p], rng.randint(1, 5))
        for q in estimators:
            for _ in range(rng.choice([1, 1, 2])):  # sometimes revised: the latest counts
                estimates.append({
                    "subjectId": p, "estimatorId": q, "formatId": "f-bounce", "kind": "athlete",
                    "value": round(strength[p] + rng.gauss(0, 200)),
                    "timestamp": START_MS + rng.randint(-10, 200) * DAY_MS,
                })
    return events, estimates


# ============================ reference replay ============================
def initial_rating(ests):
    official = [e for e in ests if e["kind"] != "athlete"]
    if official:
        return max(official, key=lambda e: e["timestamp"])["value"], gs.RD_START
    latest = {}
    for e in sorted(ests, key=lambda e: e["timestamp"]):
        latest[e["estimatorId"]] = e
    if len(latest) >= 3:
        return statistics.median(e["value"] for e in latest.values()), gs.RD_START
    return R_DEFAULT, gs.RD_MAX


def pair_score(scoring, a, b, k):
    if scoring == "score":
        return a["score"]
    if scoring == "points":
        return gs.score_from_points(a["points"], b["points"], k)
    return 1.0 if a["placement"] < b["placement"] else 0.0 if a["placement"] > b["placement"] else 0.5


def reference_replay(events, estimates, clamp):
    gs.CLAMP = clamp
    events = sorted(events, key=lambda e: (e["timestamp"], e["id"]))

    times = {}
    for ev in events:
        for p in ev["participants"]:
            times.setdefault((p["personId"], rating_format(ev["formatId"])), []).append(ev["timestamp"])
    valid = {}
    for est in estimates:
        key = (est["subjectId"], rating_format(est["formatId"]))
        if key in times and sum(1 for t in times[key] if t < est["timestamp"]) < gs.MIN_GAMES_ESTABLISHED:
            valid.setdefault(key, []).append(est)

    state, history = {}, []
    for ev in events:
        f = rating_format(ev["formatId"])
        parts = ev["participants"]
        n = len(parts)
        w = gs.WEIGHT[ev["level"]] / (n - 1)
        pre = {}
        for p in parts:
            key = (p["personId"], f)
            if key not in state:
                r0, rd0 = initial_rating(valid.get(key, []))
                state[key] = {"r": r0, "rd": rd0, "sigma": gs.SIGMA_START, "last": None, "n": 0}
            s = state[key]
            rd = s["rd"] if s["last"] is None else gs.rd_effective(s["rd"], (ev["timestamp"] - s["last"]) / DAY_MS)
            pre[p["personId"]] = (s["r"], rd, s["sigma"])
        games = {p["personId"]: [] for p in parts}
        for i in range(n):
            for j in range(i + 1, n):
                a, b = parts[i], parts[j]
                sa = pair_score(ev["scoring"], a, b, k_points(ev["formatId"]))
                games[a["personId"]].append((pre[b["personId"]][0], pre[b["personId"]][1], sa, w))
                games[b["personId"]].append((pre[a["personId"]][0], pre[a["personId"]][1], 1 - sa, w))
        for pid, gl in games.items():
            r, rd, sig = pre[pid]
            r2, rd2, sig2 = gs.glicko2_update(r, rd, sig, gl)
            r2 = gs.clamp_delta(r, r2, sum(wj * (sj - 0.5) for _, _, sj, wj in gl))
            s = state[(pid, f)]
            s.update(r=r2, rd=rd2, sigma=sig2, last=ev["timestamp"], n=s["n"] + 1)
            history.append({
                "eventId": ev["id"], "personId": pid, "formatId": f, "timestamp": ev["timestamp"],
                "rBefore": r, "rdBefore": rd, "sigmaBefore": sig,
                "rAfter": r2, "rdAfter": rd2, "sigmaAfter": sig2,
            })
    states = [{
        "personId": pid, "formatId": f, "r": s["r"], "rd": s["rd"], "sigma": s["sigma"],
        "lastEventAt": s["last"], "nBattles": s["n"],
    } for (pid, f), s in sorted(state.items(), key=lambda kv: (kv[0][1], kv[0][0]))]
    return states, history


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    scenarios = [("winner", 11, 40, 400, True), ("both", 12, 30, 200, False), ("none", 13, 30, 200, False)]
    for clamp, seed, n_people, n_events, with_history in scenarios:
        events, estimates = generate(seed, n_people, n_events)
        states, history = reference_replay(events, estimates, clamp)
        fixture = {
            "description": f"Generated by rating/export_fixtures.py (seed {seed}, CLAMP={clamp}). Do not edit by hand.",
            "params": {**PARAMS, "clamp": clamp},
            "formats": FORMATS,
            "events": events,
            "estimates": estimates,
            "expected": {"states": states, "history": history if with_history else None},
        }
        path = os.path.join(OUT_DIR, f"reference-clamp-{clamp}.json")
        with open(path, "w") as fh:
            json.dump(fixture, fh, separators=(",", ":"))
        print(f"{path}: {len(events)} events, {len(estimates)} estimates, {len(states)} states")


if __name__ == "__main__":
    main()
