# Video prototype (development step 7)

As of 2026-10-11 · Status: **test page built, waiting for results from real phones** · Related:
`docs/concept.md` section 6, `docs/architecture.md` §5 step 7

The test page lives at **`/lab/video`** in the live app (no login needed):
<https://highline-freestyle-battles.highlinefreestyle.workers.dev/lab/video>

It records inside the app, stores every second of video locally, cuts without re-encoding and
builds a report. Nothing is uploaded and nothing touches battles or ratings.

---

## 1. Guide for testers

Use a phone (iPhone with Safari, Android with Chrome). Ideally test outside at a line, but a room works too.

1. Open the link above. Optional: add it to the home screen and test from there as well.
2. Tap **Turn on camera** and allow camera and microphone.
3. Record 3 attempts with different settings, each 20–60 s:
   - Quality **Normal**, everything else automatic.
   - Quality **HD**.
   - Quality **Data saver**.
4. For one recording: while it runs, switch to another app. The recording should end by itself
   and a notice should say so; check that the video up to that moment plays.
5. For another recording: close the browser/app **while recording**, open the page again. A notice
   about an interrupted recording should appear; check whether it plays.
6. Open each recording, play it, then cut a piece: pause → **Start here**, pause later → **End here**
   → **Cut**. Play the cut video and download it once.
7. Tap **Share report** for each recording and send the reports (WhatsApp/Signal/e-mail is fine) to
   the project owner, together with a few words:
   - Did the preview and the cut video play, with sound? Was the picture sharp enough?
   - Did the phone get hot, or did anything freeze or crash?
   - Phone model and iOS/Android version.

---

## 2. What the page does (technical)

| Part | Implementation |
|---|---|
| Camera | `getUserMedia` with ideal width/height/frame rate of the quality level, back camera by default |
| Recording | `MediaRecorder` with the bit rates of the quality level (`apps/web/src/video/quality.ts`); format preference H.264/MP4, then WebM (`recorder.ts`) |
| Keyframes | `videoKeyFrameIntervalDuration` = 1 s (Chrome 113+; others ignore it). Selectable: 1 s, 2 s, browser default |
| Attempt limit | Pressing Start uses up an attempt (counter on the page, resettable for testing) |
| Camera view | Full screen with one record button (red circle = start, red square = stop); controls at the bottom in portrait, on the right in landscape |
| Leaving the app | Ends the recording (`visibilitychange`/`pagehide`, or the video track ends or is muted); the camera is released. The record keeps `endReason` (`app_left`, `camera_lost`) |
| Local storage | Every 1-second chunk goes into IndexedDB immediately (`storage.ts`), as ArrayBuffer (old Safari cannot store Blobs). `navigator.storage.persist()` is requested before the first recording |
| Crash recovery | Recordings still marked "recording" on page load are marked "interrupted"; their chunks form a readable file up to the last stored chunk |
| Cutting | Own small parsers/writers, no library, no re-encoding (`mp4.ts`, `webm.ts`, `trim.ts`). The cut starts at the last keyframe at or before the chosen start. Output: classic MP4 (moov first) or WebM with duration and cues |
| Preview | The whole recording is rewritten once (same code path as cutting), because raw MediaRecorder files cannot be seeked (Chrome WebM has no duration and no index) |

Tests: `apps/web/test/trim.test.ts` with real Chromium recordings (WebM/VP8, fragmented MP4/VP9) and
ffmpeg files shaped like Safari's (fragmented H.264/AAC) and like a camera app's (classic MP4 with
B-frames). If ffmpeg is installed, the tests also check that it decodes every cut without errors.

---

## 3. Findings so far

Checked in desktop Chromium with a fake camera (`/lab/video`, Playwright):

- **Chrome without a keyframe interval writes only one keyframe** at the very start. Cutting would
  then always start at 0, and Chrome's MP4 output only emits data at keyframes, so a crash would lose
  the whole recording. With `videoKeyFrameIntervalDuration: 1000` there is a keyframe (and a stored
  chunk) every second. **Keep this setting.**
- Chromium's open-source build has no H.264 encoder; it records VP9 in MP4 or VP8/VP9 in WebM.
  Real Chrome on Android should offer H.264 – to be confirmed by the reports.
- Recording, preview, cutting (a few milliseconds for a few seconds of video) and crash recovery
  work for both MP4 and WebM.

**Android, Chrome 154 (owner, 2026-10-11):**

- Records H.264 + AAC in MP4 (`avc1.64001f`), all MP4/WebM variants supported.
- Keyframe every ~1.0 s (our option works); a chunk is stored every second; persistent storage granted.
- Normal quality, 60 s landscape: 1280×720 at 30 fps, **19.9 MB/min** (expected 19). Rewriting the
  whole 60 s file for the preview took 80 ms; a cut takes a few ms.
- Holding the phone upright gives a portrait video (720×1280), landscape gives 1280×720.
- **Switching apps during a recording froze the picture** while the sound continued (the camera
  pauses in the background; ~350 of 1800 frames were missing), and after returning the picture
  stayed frozen. → Decision: leaving the app ends the attempt (concept section 6), implemented.
- Feedback: in landscape the Start button was out of reach → full-screen camera view, implemented.

Open, to be answered by the phone tests:

1. Safari (iPhone): which format and codec, keyframe interval (Safari ignores our option), does a
   chunk arrive every second, does the cut start close enough to the chosen start?
2. Real file sizes per quality level (MB/min) and actual resolution/frame rate.
3. Does IndexedDB keep large recordings (HD, 60 s ≈ 45 MB) on iPhones, and is persistent storage granted?
4. Cutting time and memory for 60 s HD files on older phones.
5. iPhone: does the recording end cleanly when the app is left, and do the events show up in the report?
6. Android: HD file sizes and the crash test (close the browser while recording).

## 4. Next steps after the tests

- Decide the format strategy (likely: H.264/MP4 everywhere, WebM fallback) and the keyframe interval.
- Tune bit rates of the quality levels.
- Step 8: connect recording to real battle attempts (attempt record at Start), upload queue to R2.
