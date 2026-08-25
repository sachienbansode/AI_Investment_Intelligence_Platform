# Make the LinkedIn video from the REAL pipeline.html (HD, exact CSS quality)

The animation is `frontend/public/pipeline.html`. Two ways to record it — the
sandbox here has no browser, so this is done on your machine (which has Chrome).

## Option A — no code (2 min)
1. Open `frontend/public/pipeline.html` in Chrome, press F11 (full screen).
2. Start a screen recording:
   - Windows: Win + Alt + R (Xbox Game Bar).
   - Mac: Cmd + Shift + 5 → Record.
3. Let one full loop play (~34s), then stop. You now have an MP4/MOV.
4. Add music (optional): drop `presentation/pipeline_music.mp3` (royalty-free,
   composed for us) onto the clip in any editor — or via ffmpeg (Option B step 3).

## Option B — automated, pixel-perfect (recommended)
Prereqs once: install ffmpeg (on PATH) and, in `frontend/`:
    npm i puppeteer puppeteer-screen-recorder
Then from `frontend/`:
    node ../presentation/record_pipeline.mjs
That writes `presentation/niytri_pipeline_hd.mp4` (silent, 1080p, exact HTML).

Add the royalty-free music:
    ffmpeg -y -i presentation/niytri_pipeline_hd.mp4 -i presentation/pipeline_music.mp3 ^
      -c:v copy -c:a aac -b:a 192k -shortest -movflags +faststart ^
      presentation/niytri_pipeline_final.mp4

Upload `niytri_pipeline_final.mp4` to LinkedIn. (`pipeline_music.mp3` is an original
composition — no third-party licence needed.)
