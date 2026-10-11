# Auto-cut: detecting bounce boundaries (design notes)

As of 2026-10-11 · Status: **idea / not scheduled yet** · Related: `docs/concept.md` sections 6, 9, 14

---

## 1. Goal

After recording, the app suggests **cut points at the bottom dead center (BDC) of each bounce**, so a
combo video can be split into one clip per bounce/trick. Cut points are always shown as **suggestions on
a timeline** – the user confirms or drags them before upload. Accuracy of roughly ±0.3 s is good enough;
the user corrects the rest.

Data model impact: none. The app already stores "one video + list of cut timestamps" (concept section 6).

---

## 2. Domain facts we can rely on

- **Bounce frequency is nearly constant** for a given line, typically one bounce every **3–4 s**.
- **At the bottom the athlete is almost still for up to ~1 s**: body barely moves, legs are pushed
  straight, and the line itself is momentarily at rest relative to the background.
- Rotations, arm movements and tricks happen **on the way up and at the top**.
- Typical filming: camera **~30 m away**, either fixed or **only tilting/panning** to keep the athlete
  centered (no translation). Dynamic drone shots are out of scope – they are not used for competitions.

---

## 3. Approach A – foreground vs. background motion (preferred first attempt)

Idea (from the project owner): measure how the athlete and line move **relative to the background**.
At BDC this relative motion drops to almost zero, regardless of whether the camera is fixed or tilting.

Why it works with a tilting camera: from 30 m away, tilting/panning shifts the whole background almost
uniformly. That global shift can be estimated and subtracted; what remains is the motion of the
foreground (athlete + line) relative to the scene.

Pipeline (per analyzed frame, on a downscaled grayscale image, e.g. 160–320 px wide, 10–15 fps is enough):

1. **Global (camera) motion:** estimate the dominant image shift between consecutive frames, e.g. by
   phase correlation or sparse feature tracking on the frame borders / background. With tilt/pan only,
   a simple translation (optionally + small rotation) is sufficient.
2. **Compensate:** shift the previous frame by the estimated global motion.
3. **Residual motion:** dense optical flow or simple frame differencing on the compensated frames.
   The energy of the residual motion (mostly athlete + line) is the signal `M(t)`.
4. Smooth `M(t)`; **long, low plateaus = candidate BDCs**.

Strengths: very cheap (no neural network), robust to the athlete being partly occluded, uses the line
as well as the body. Can run in the browser with plain canvas/WebGL or OpenCV.js.

Known risk: the **top of the bounce** is also a turning point with low vertical speed. It is usually
distinguishable because tricks/rotations happen there and the airtime phase looks different, but this
must be verified on real footage. Section 5 describes how to disambiguate.

---

## 4. Approach B – body pose (MediaPipe)

1. Run pose estimation (MediaPipe Pose, JS/WASM build, on-device) on every 2nd–5th frame.
2. Compute the speed of keypoints **relative to each other** (shoulders, hips, wrists, head),
   normalized by shoulder width → independent of zoom and camera movement.
3. Additional BDC cue: **knee angle close to 180°** (legs pushed straight).
4. Low relative keypoint speed + straight legs = candidate BDC.

Strengths: distinguishes top vs. bottom reliably (leg extension, body posture). Heavier to compute
than approach A, and fails when the athlete is very small in the frame or leaves it.

---

## 5. Combining both and using the bounce period

1. Compute `M(t)` (approach A). Where available, compute the pose signal and knee angle (approach B).
2. **Estimate the bounce period T** via autocorrelation (or FFT) of the motion signal; expect 3–4 s.
   If both top and bottom produce minima, the autocorrelation shows peaks at T/2 and T – take the one
   that fits the expected range and use pose/leg extension to decide which minima are bottoms.
3. **Find a first confident BDC** (longest/deepest low-motion plateau with straight legs if pose is
   available).
4. **Predict** the next BDCs at `t0 + n·T` and only **refine locally** (±0.5·T window) instead of searching
   the whole video. This keeps the result stable when individual frames are noisy.
5. Show the suggestions; the user confirms or adjusts.

Fallback: if no confident signal is found, show evenly spaced markers at the estimated period, or none.

---

## 6. Where it runs

- **On the phone, after recording** (not real time). A 15–60 s clip analyzed at reduced resolution and
  frame rate should take seconds, not minutes, on recent phones.
- Optional fallback for weak devices later: analysis in the background job (GitHub Actions / home
  server), returning only timestamps.

---

## 7. Side benefit: store the motion data

Store the per-frame signals (motion energy, optionally pose keypoints) alongside the video. They are a
few KB per video and are exactly the raw material for later **AI trick recognition** (concept section 14),
without re-analyzing the videos.

---

## 8. Test plan

Before building it into the app, prototype it as a standalone script/page and test on real footage:

- fixed camera vs. tilting camera
- different lines (length, tension → different periods)
- different lighting, line visibility, athlete size in frame
- combos with and without pauses, falls

Success criterion: on clean competition-style footage, at least ~90 % of suggested cut points within
±0.3 s of the true BDC, so users mostly just confirm.

**Needed from the project owner:** a set of ~10–20 real test videos covering the cases above, with the
true BDC times noted roughly (or marked once by hand in the prototype).

---

## 9. Scheduling

Not part of stage 1. Good candidate to explore together with the **video prototype** (recording,
trimming, offline storage), since both run on the phone and need real-device testing. Productive use
belongs to stage 3 (cut points / splitting into clips).
