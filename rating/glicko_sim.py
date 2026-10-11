"""
Highline-Battle-Rating: gewichtetes Glicko-2 + Inaktivitaets-Modell + Simulation

Aufruf:
  python glicko_sim.py              -> Rechenbeispiele + Simulation
  python glicko_sim.py beispiele    -> nur Rechenbeispiele
  python glicko_sim.py sim 7        -> nur Simulation mit Seed 7

Alle Stellschrauben stehen im Block PARAMETER. Einfach aendern und neu laufen lassen.
"""
import math
import random
import sys
from collections import defaultdict

import numpy as np

# ============================ PARAMETER ============================
SCALE = 173.7178          # Glicko-2-Umrechnung (= 400/ln10), nicht aendern
TAU = 0.5                 # wie schnell sich die Volatilitaet aendern darf (0.3-1.2)
SIGMA_START = 0.06        # Start-Volatilitaet
RD_START = 200            # Unsicherheit nach Admin-Ersteinstufung
RD_MAX = 350              # Obergrenze Unsicherheit (= "voellig unbekannt")
GRACE_DAYS = 30           # Karenzzeit ohne Inaktivitaets-Effekt
C_INACT = 0.94            # RD = sqrt(RD_last^2 + (C_INACT * (Tage - Karenz))^2)
K_DISPLAY = 2.0           # Ranking-Wert = Wertung - K_DISPLAY * RD
PROVISIONAL_RD = 110      # darueber gilt ein Rating als vorlaeufig ("?")
MIN_GAMES_ESTABLISHED = 5
WEIGHT = {1: 0.25, 2: 0.5, 3: 1.0, 4: 1.5, 5: 2.0}  # Battle-Stufe -> Faktor
K_POINTS = 2.0            # Punkte -> Score: s = a^k / (a^k + b^k)
CLAMP = "winner"          # "none" | "winner" (Sieger verliert nie) | "both" (+ Verlierer gewinnt nie)

# Simulation
N_PLAYERS = 120
N_FORMATS = 3
WEEKS = 104               # 1 Rating-Periode = 1 Woche
SEED = 1
ADMIN_NOISE = 150         # Fehler der Admin-Ersteinstufung (Standardabw.)
COMMUNITY_SIZE = 20       # diese Gruppe wird systematisch ...
COMMUNITY_BIAS = 250      # ... um so viele Punkte zu hoch eingestuft
GRADED_SHARE = 0.5        # Anteil Battles mit abgestufter Deutlichkeit
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
    """games: Liste von (r_gegner, rd_gegner, score 0..1, gewicht).
    Gewicht w wirkt wie 'dieses Battle zaehlt w-mal' (gewichtete Likelihood)."""
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
    """outcome = Summe(w*(s-0.5)) des Events: >0 gewonnen, <0 verloren"""
    if CLAMP in ("winner", "both") and outcome > 0 and r_new < r_old:
        return r_old
    if CLAMP == "both" and outcome < 0 and r_new > r_old:
        return r_old
    return r_new


def score_from_points(a, b, k=K_POINTS):
    """Punkte -> Score 0..1. k=1: a/(a+b). k>1 spreizt staerker."""
    if a + b == 0:
        return 0.5
    return a ** k / (a ** k + b ** k)


# ============================ BEISPIELE ============================
def beispiele():
    print("=== Rechenbeispiele (ein einzelnes Battle, Gewicht 1) ===")

    def zeige(titel, r, rd, o, ord_, s):
        r2, rd2, _ = glicko2_update(r, rd, SIGMA_START, [(o, ord_, s, 1.0)])
        o2, ord2, _ = glicko2_update(o, ord_, SIGMA_START, [(r, rd, 1 - s, 1.0)])
        e = expected(r, o, ord_)
        print(f"{titel:34s} Erwartung {e:.3f} | Du {r:.0f}±{rd:.0f} -> {r2:.0f}±{rd2:.0f} ({r2 - r:+.0f})"
              f" | Gegner {o:.0f}±{ord_:.0f} -> {o2:.0f}±{ord2:.0f} ({o2 - o:+.0f})")

    rd_in = rd_effective(50, 210)
    print(f"(RD nach 7 Monaten Inaktivitaet, vorher 50: {rd_in:.0f})")
    zeige("3000 aktiv vs 2000, Sieg", 3000, 50, 2000, 50, 1)
    zeige("3000 aktiv vs 2000, Niederlage", 3000, 50, 2000, 50, 0)
    zeige("3000 inaktiv vs 2000, Sieg", 3000, rd_in, 2000, 50, 1)
    zeige("3000 inaktiv vs 2000, Niederlage", 3000, rd_in, 2000, 50, 0)
    zeige("3000 inaktiv vs 2000, knapp 0.25", 3000, rd_in, 2000, 50, 0.25)
    zeige("1600 vs 1500, Sieg", 1600, 60, 1500, 60, 1)
    zeige("1600 vs 1500, Niederlage", 1600, 60, 1500, 60, 0)
    zeige("Neuling 1600±200 vs 1500±60, Sieg", 1600, 200, 1500, 60, 1)

    print("\n=== Inaktivitaet (vorher RD 50) ===")
    print("Tage  RD   Abzug im Ranking (Wertung bleibt)")
    for d in (30, 60, 90, 120, 180, 270, 365, 540):
        rd = rd_effective(50, d)
        print(f"{d:4d}  {rd:4.0f}  -{K_DISPLAY * (rd - 50):.0f}")

    print("\n=== Punkte -> Score ===")
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
    breaks[top] = (40, 80)  # Topspieler pausiert Woche 40-80

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
            # Sofortige Aktualisierung: alle Beteiligten eines Events gleichzeitig
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

        # 1) Einzelbattles, grob nach Rating gepaart
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

        # 2) Gruppenbattle (4 Personen, Stufe 2) alle 2 Wochen, 3) Competition (12, nur Platzierungen, Stufe 5) alle 8 Wochen
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

    # ---------------- Auswertung ----------------
    W = WEEKS
    print(f"\n=== Simulation: {N} Spieler, {F} Formate, {W} Wochen, Seed {seed} ===")

    print("\n[1] Inflation/Deflation: mittlere Abweichung Wertung - wahre Staerke")
    print("Woche  ohne Community  alle")
    for w in (0, 13, 26, 52, 78, W - 1):
        print(f"{w:5d}  {drift[w][0]:+8.0f}      {drift[w][1]:+6.0f}")

    def established(i, f):
        s = st[i][f]
        return s["n"] >= MIN_GAMES_ESTABLISHED and rd_now(s, W) < PROVISIONAL_RD

    print("\n[2] Genauigkeit am Ende (nur etablierte Ratings)")
    for f in range(F):
        idx = [i for i in range(N) if established(i, f)]
        disp = [st[i][f]["r"] - K_DISPLAY * rd_now(st[i][f], W) for i in idx]
        err = [abs(st[i][f]["r"] - true[i][f]) for i in idx]
        print(f"Format {f}: {len(idx):3d} etabliert, Rangkorrelation {spearman(disp, [true[i][f] for i in idx]):.2f},"
              f" mittl. Fehler {np.mean(err):.0f} Punkte")

    print("\n[3] Erkennung Ueber-Einstufung (Spieler-Format-Eintraege mit >=10 Battles)")
    for name, grp in (("normal", [i for i in range(N) if i not in community]), ("Community", list(community))):
        d = [st[i][f]["r"] - st[i][f]["init"] for i in grp for f in range(F) if st[i][f]["n"] >= 10]
        res = [st[i][f]["res"] / st[i][f]["resw"] for i in grp for f in range(F) if st[i][f]["n"] >= 10]
        if len(d) < 2:
            print(f"{name}: zu wenig Daten")
            continue
        z = np.mean(d) / (np.std(d, ddof=1) / math.sqrt(len(d)))
        print(f"{name:10s} n={len(d):3d}  Wertung-Start {np.mean(d):+5.0f}  (z={z:+.1f})"
              f"  Residuum erste 10 Battles {np.mean(res):+.3f}")

    print(f"\n[4] Topspieler P{top:03d} (Format 0), Pause Woche 40-80")
    print("Woche  Wertung   RD  Ranking-Wert")
    for w, r, rd, disp in top_traj[36:W:4]:
        print(f"{w:5d}  {r:7.0f}  {rd:4.0f}  {disp:7.0f}")

    print("\n[5] Kombi-Ranking (z-Wert je Format, nur etablierte, Mittel ueber >=2 Formate)")
    z = {}
    for f in range(F):
        idx = [i for i in range(N) if established(i, f)]
        vals = np.array([st[i][f]["r"] - K_DISPLAY * rd_now(st[i][f], W) for i in idx])
        m, sd = vals.mean(), vals.std()
        for i, v in zip(idx, vals):
            z.setdefault(i, []).append((v - m) / sd)
    comb = {i: float(np.mean(v)) for i, v in z.items() if len(v) >= 2}
    ids = list(comb)
    print(f"{len(ids)} Spieler im Kombi-Ranking, Rangkorrelation mit wahrer Staerke "
          f"{spearman([comb[i] for i in ids], [true_base[i] for i in ids]):.2f}")
    true_rank = {i: k + 1 for k, i in enumerate(sorted(range(N), key=lambda i: -true_base[i]))}
    print("Platz Spieler  Kombi  Formate  wahrer Platz")
    for k, i in enumerate(sorted(ids, key=lambda i: -comb[i])[:10], 1):
        tag = " (Community)" if i in community else ""
        print(f"{k:5d}  P{i:03d}   {comb[i]:+.2f}   {len(z[i])}        {true_rank[i]}{tag}")


if __name__ == "__main__":
    args = sys.argv[1:]
    if not args or args[0] == "beispiele":
        beispiele()
    if not args or args[0] == "sim":
        simulate(int(args[1]) if len(args) > 1 else SEED)
