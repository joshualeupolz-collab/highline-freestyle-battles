"""
Highline battle rating: weighted Glicko-2 + inactivity model + simulation

Usage:
  python glicko_sim.py              -> worked examples + simulation
  python glicko_sim.py examples     -> worked examples only
  python glicko_sim.py sim 7        -> simulation only, with seed 7

All tuning knobs are in the PARAMETERS block. Change them and run again.
"""
import math
import random
import sys
from collections import defaultdict

import numpy as np

# ============================ PARAMETERS ============================
SCALE = 173.7178          # Glicko-2 conversion (= 400/ln10), do not change
TAU = 0.5                 # how fast volatility may change (0.3-1.2)
SIGMA_START = 0.06        # initial volatility
RD_START = 200            # uncertainty after initial admin estimate
RD_MAX = 350              # upper limit of uncertainty (= "completely unknown")
GRACE_DAYS = 30           # grace period without inactivity effect
C_INACT = 0.94            # RD = sqrt(RD_last^2 + (C_INACT * (days - grace))^2)
K_DISPLAY = 2.0           # ranking value = rating - K_DISPLAY * RD
PROVISIONAL_RD = 110      # above this a rating is provisional ("?")
MIN_GAMES_ESTABLISHED = 5
WEIGHT = {1: 0.25, 2: 0.5, 3: 1.0, 4: 1.5, 5: 2.0}  # battle level -> factor
K_POINTS = 2.0            # points -> score: s = a^k / (a^k + b^k)
CLAMP = "winner"          # "none" | "winner" (winner never loses) | "both" (+ loser never gains)

# Simulation
N_PLAYERS = 120
N_FORMATS = 3
WEEKS = 104               # 1 rating period = 1 week
SEED = 1
ADMIN_NOISE = 150         # error of the initial admin estimate (std. dev.)
COMMUNITY_SIZE = 20       # this group is systematically ...
COMMUNITY_BIAS = 250      # ... rated this many points too high
GRADED_SHARE = 0.5        # share of battles with graded margin
LEVEL_PROBS = {1: .25, 2: .25, 3: .35, 4: .10, 5: .05}
# ===================================================================


def g(phi):
    return 1 / math.sqrt(1 + 3 * phi * phi / math.pi ** 2)


def expected(r, r_opp, rd_opp):
    mu, mu_j, phi_j = (r - 1500) / SCALE, (r_opp - 1500) / SCALE, rd_opp / SCALE
    return 1 / (1 + math.exp(-g(phi_j) * (mu - mu_j)))


def new_sigma(sigma, phi, v, delta, tau=TAU, eps=1e-6):
    a = math.log(sigma ** 2)

    def f(x):
        ex = math.exp(x)
        return ex * (delta ** 2 - phi ** 2 - v - ex) / (2 * (phi ** 2 + v + ex) ** 2) - (x - a) / tau ** 2

    A = a
    if delta ** 2 > phi ** 2 + v:
        B = math.log(delta ** 2 - phi ** 2 - v)
    else:
        k = 1
        while f(a - k * tau) < 0:
            k += 1
        B = a - k * tau
    fA, fB = f(A), f(B)
    while abs(B - A) > eps:
        C = A + (A - B) * fA / (fB - fA)
        fC = f(C)
        if fC * fB <= 0:
            A, fA = B, fB
        else:
            fA /= 2
        B, fB = C, fC
    return math.exp(A / 2)


def glicko2_update(r, rd, sigma, games):
    """games: list of (r_opponent, rd_opponent, score 0..1, weight).
    Weight w acts like 'this battle counts w times' (weighted likelihood)."""
    if not games:
        return r, rd, sigma
    mu, phi = (r - 1500) / SCALE, rd / SCALE
    vinv = dsum = 0.0
    for rj, rdj, s, w in games:
        mu_j, phi_j = (rj - 1500) / SCALE, rdj / SCALE
        gj = g(phi_j)
        e = 1 / (1 + math.exp(-gj * (mu - mu_j)))
        vinv += w * gj * gj * e * (1 - e)
        dsum += w * gj * (s - e)
    if vinv < 1e-12:
        return r, rd, sigma
    v = 1 / vinv
    sig = new_sigma(sigma, phi, v, v * dsum)
    phi_star = math.sqrt(phi ** 2 + sig ** 2)
    phi_new = 1 / math.sqrt(1 / phi_star ** 2 + 1 / v)
    mu_new = mu + phi_new ** 2 * dsum
    return 1500 + SCALE * mu_new, SCALE * phi_new, sig


def rd_effective(rd_last, days_inactive):
    t = max(0, days_inactive - GRACE_DAYS)
    return min(RD_MAX, math.sqrt(rd_last ** 2 + (C_INACT * t) ** 2))


def clamp_delta(r_old, r_new, outcome):
    """outcome = sum(w*(s-0.5)) of the event: >0 won, <0 lost"""
    if CLAMP in ("winner", "both") and outcome > 0 and r_new < r_old:
        return r_old
    if CLAMP == "both" and outcome < 0 and r_new > r_old:
        return r_old
    return r_new


def score_from_points(a, b, k=K_POINTS):
    """points -> score 0..1. k=1: a/(a+b). k>1 spreads more."""
    if a + b == 0:
        return 0.5
    return a ** k / (a ** k + b ** k)


# ============================ EXAMPLES ============================
def examples():
    print("=== Worked examples (a single battle, weight 1) ===")

    def show(title, r, rd, o, ord_, s):
        r2, rd2, _ = glicko2_update(r, rd, SIGMA_START, [(o, ord_, s, 1.0)])
        o2, ord2, _ = glicko2_update(o, ord_, SIGMA_START, [(r, rd, 1 - s, 1.0)])
        e = expected(r, o, ord_)
        print(f"{title:34s} Expected {e:.3f} | You {r:.0f}±{rd:.0f} -> {r2:.0f}±{rd2:.0f} ({r2 - r:+.0f})"
              f" | Opponent {o:.0f}±{ord_:.0f} -> {o2:.0f}±{ord2:.0f} ({o2 - o:+.0f})")

    rd_in = rd_effective(50, 210)
    print(f"(RD after 7 months of inactivity, previously 50: {rd_in:.0f})")
    show("3000 active vs 2000, win", 3000, 50, 2000, 50, 1)
    show("3000 active vs 2000, loss", 3000, 50, 2000, 50, 0)
    show("3000 inactive vs 2000, win", 3000, rd_in, 2000, 50, 1)
    show("3000 inactive vs 2000, loss", 3000, rd_in, 2000, 50, 0)
    show("3000 inactive vs 2000, close 0.25", 3000, rd_in, 2000, 50, 0.25)
    show("1600 vs 1500, win", 1600, 60, 1500, 60, 1)
    show("1600 vs 1500, loss", 1600, 60, 1500, 60, 0)
    show("Newcomer 1600±200 vs 1500±60, win", 1600, 200, 1500, 60, 1)

    print("\n=== Inactivity (previously RD 50) ===")
    print("Days  RD   Ranking deduction (rating unchanged)")
    for d in (30, 60, 90, 120, 180, 270, 365, 540):
        rd = rd_effective(50, d)
        print(f"{d:4d}  {rd:4.0f}  -{K_DISPLAY * (rd - 50):.0f}")

    print("\n=== Points -> score ===")
    for a, b in ((150, 80), (100, 90), (200, 50), (80, 0)):
        print(f"{a}:{b}  k=1 -> {score_from_points(a, b, 1):.2f}   k=2 -> {score_from_points(a, b, 2):.2f}")


# ============================ SIMULATION ============================
def spearman(x, y):
    rx, ry = np.argsort(np.argsort(x)), np.argsort(np.argsort(y))
    return float(np.corrcoef(rx, ry)[0, 1])


def simulate(seed=SEED):
    rng = random.Random(seed)
    N, F = N_PLAYERS, N_FORMATS
    true_base = [rng.gauss(1700, 350) for _ in range(N)]
    true = [[tb + rng.gauss(0, 120) for _ in range(F)] for tb in true_base]
    community = set(rng.sample(range(N), COMMUNITY_SIZE))
    activity = [rng.uniform(0.15, 0.6) for _ in range(N)]
    breaks = {}
    for i in range(N):
        if rng.random() < 0.2:
            s = rng.randint(0, 90)
            breaks[i] = (s, s + rng.randint(8, 40))
    top = max(range(N), key=lambda i: true_base[i])
    breaks[top] = (40, 80)  # top player takes a break in weeks 40-80

    st = [[None] * F for _ in range(N)]
    for i in range(N):
        est = true_base[i] + rng.gauss(0, ADMIN_NOISE) + (COMMUNITY_BIAS if i in community else 0)
        for f in range(F):
            st[i][f] = dict(r=est, rd=RD_START, sig=SIGMA_START, last=None, n=0, init=est, res=0.0, resw=0.0)

    def rd_now(s, week):
        return s["rd"] if s["last"] is None else rd_effective(s["rd"], 7 * (week - s["last"]))

    def p_true(a, b):
        return 1 / (1 + 10 ** (-(a - b) / 400))

    drift, top_traj = [], []
    for week in range(WEEKS):
        games = defaultdict(list)

        def flush():
            # Immediate update: all participants of an event simultaneously
            for (i, f), gl in games.items():
                s = st[i][f]
                rd0 = rd_now(s, week)
                if s["n"] < 10:
                    for rj, rdj, sc, w in gl:
                        s["res"] += w * (sc - expected(s["r"], rj, rdj))
                        s["resw"] += w
                r, rd, sig = glicko2_update(s["r"], rd0, s["sig"], gl)
                r = clamp_delta(s["r"], r, sum(w * (sc - 0.5) for _, _, sc, w in gl))
                s.update(r=r, rd=rd, sig=sig, last=week, n=s["n"] + len(gl))
            games.clear()

        def add_pair(i, j, f, s_i, w):
            si, sj = st[i][f], st[j][f]
            games[(i, f)].append((sj["r"], rd_now(sj, week), s_i, w))
            games[(j, f)].append((si["r"], rd_now(si, week), 1 - s_i, w))

        active = [i for i in range(N) if not (i in breaks and breaks[i][0] <= week < breaks[i][1])]

        # 1) Single battles, roughly paired by rating
        for f in range(F):
            part = [i for i in active if rng.random() < activity[i] / F * 1.5]
            part.sort(key=lambda i: st[i][f]["r"] + rng.gauss(0, 150))
            for a, b in zip(part[0::2], part[1::2]):
                p = p_true(true[a][f], true[b][f])
                lvl = rng.choices(list(LEVEL_PROBS), weights=list(LEVEL_PROBS.values()))[0]
                if rng.random() < GRADED_SHARE:
                    s = rng.betavariate(max(p * 6, 1e-3), max((1 - p) * 6, 1e-3))
                else:
                    s = 1.0 if rng.random() < p else 0.0
                add_pair(a, b, f, s, WEIGHT[lvl])
                flush()

        # 2) Group battle (4 people, level 2) every 2 weeks, 3) competition (12, placements only, level 5) every 8 weeks
        events = []
        if week % 2 == 0:
            events.append((4, 2))
        if week % 8 == 4:
            events.append((12, 5))
        for n, lvl in events:
            if len(active) < n:
                continue
            f = rng.randrange(F)
            grp = rng.sample(active, n)
            perf = {i: true[i][f] + rng.gauss(0, 200) for i in grp}
            ranked = sorted(grp, key=lambda i: -perf[i])
            for x in range(n):
                for y in range(x + 1, n):
                    add_pair(ranked[x], ranked[y], f, 1.0, WEIGHT[lvl] / (n - 1))
            flush()

        played = [(i, f) for i in range(N) for f in range(F) if st[i][f]["n"] > 0]
        normal = [(i, f) for i, f in played if i not in community]
        drift.append((np.mean([st[i][f]["r"] - true[i][f] for i, f in normal]),
                      np.mean([st[i][f]["r"] - true[i][f] for i, f in played])))
        s = st[top][0]
        rdn = rd_now(s, week)
        top_traj.append((week, s["r"], rdn, s["r"] - K_DISPLAY * rdn))

    # ---------------- Evaluation ----------------
    W = WEEKS
    print(f"\n=== Simulation: {N} players, {F} formats, {W} weeks, seed {seed} ===")

    print("\n[1] Inflation/deflation: mean deviation rating - true strength")
    print("Week   w/o community   all")
    for w in (0, 13, 26, 52, 78, W - 1):
        print(f"{w:5d}  {drift[w][0]:+8.0f}      {drift[w][1]:+6.0f}")

    def established(i, f):
        s = st[i][f]
        return s["n"] >= MIN_GAMES_ESTABLISHED and rd_now(s, W) < PROVISIONAL_RD

    print("\n[2] Accuracy at the end (established ratings only)")
    for f in range(F):
        idx = [i for i in range(N) if established(i, f)]
        disp = [st[i][f]["r"] - K_DISPLAY * rd_now(st[i][f], W) for i in idx]
        err = [abs(st[i][f]["r"] - true[i][f]) for i in idx]
        print(f"Format {f}: {len(idx):3d} established, rank correlation {spearman(disp, [true[i][f] for i in idx]):.2f},"
              f" mean error {np.mean(err):.0f} points")

    print("\n[3] Over-rating detection (player-format entries with >=10 battles)")
    for name, grp in (("normal", [i for i in range(N) if i not in community]), ("Community", list(community))):
        d = [st[i][f]["r"] - st[i][f]["init"] for i in grp for f in range(F) if st[i][f]["n"] >= 10]
        res = [st[i][f]["res"] / st[i][f]["resw"] for i in grp for f in range(F) if st[i][f]["n"] >= 10]
        if len(d) < 2:
            print(f"{name}: not enough data")
            continue
        z = np.mean(d) / (np.std(d, ddof=1) / math.sqrt(len(d)))
        print(f"{name:10s} n={len(d):3d}  rating-start {np.mean(d):+5.0f}  (z={z:+.1f})"
              f"  residual first 10 battles {np.mean(res):+.3f}")

    print(f"\n[4] Top player P{top:03d} (format 0), break weeks 40-80")
    print("Week    Rating   RD  Ranking value")
    for w, r, rd, disp in top_traj[36:W:4]:
        print(f"{w:5d}  {r:7.0f}  {rd:4.0f}  {disp:7.0f}")

    print("\n[5] Combined ranking (z-value per format, established only, mean over >=2 formats)")
    z = {}
    for f in range(F):
        idx = [i for i in range(N) if established(i, f)]
        vals = np.array([st[i][f]["r"] - K_DISPLAY * rd_now(st[i][f], W) for i in idx])
        m, sd = vals.mean(), vals.std()
        for i, v in zip(idx, vals):
            z.setdefault(i, []).append((v - m) / sd)
    comb = {i: float(np.mean(v)) for i, v in z.items() if len(v) >= 2}
    ids = list(comb)
    print(f"{len(ids)} players in combined ranking, rank correlation with true strength "
          f"{spearman([comb[i] for i in ids], [true_base[i] for i in ids]):.2f}")
    true_rank = {i: k + 1 for k, i in enumerate(sorted(range(N), key=lambda i: -true_base[i]))}
    print("Rank  Player   Combo  Formats  true rank")
    for k, i in enumerate(sorted(ids, key=lambda i: -comb[i])[:10], 1):
        tag = " (Community)" if i in community else ""
        print(f"{k:5d}  P{i:03d}   {comb[i]:+.2f}   {len(z[i])}        {true_rank[i]}{tag}")


if __name__ == "__main__":
    args = sys.argv[1:]
    if not args or args[0] == "examples":
        examples()
    if not args or args[0] == "sim":
        simulate(int(args[1]) if len(args) > 1 else SEED)
