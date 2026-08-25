// Records the REAL pipeline.html (pixel-perfect CSS) to an MP4.
// Prereqs (one-time):  npm i puppeteer puppeteer-screen-recorder
//                      + ffmpeg on your PATH (https://ffmpeg.org/download.html)
// Run from the frontend folder:  node ../presentation/record_pipeline.mjs
import puppeteer from 'puppeteer'
import { PuppeteerScreenRecorder } from 'puppeteer-screen-recorder'
import path from 'path'
const url = 'file://' + path.resolve('public/pipeline.html')
const out = path.resolve('../presentation/niytri_pipeline_hd.mp4')
const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--hide-scrollbars', '--force-color-profile=srgb', '--window-size=1920,1080']
})
const page = await browser.newPage()
await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 2 })
await page.goto(url, { waitUntil: 'networkidle0' })
const rec = new PuppeteerScreenRecorder(page, {
  fps: 30, videoFrame: { width: 1920, height: 1080 },
  videoCodec: 'libx264', videoCrf: 18, videoPreset: 'medium'
})
await rec.start(out)
await new Promise(r => setTimeout(r, 34000))  // ~one full loop (intro→8 stages→outro)
await rec.stop()
await browser.close()
console.log('Saved silent HD video:', out)
