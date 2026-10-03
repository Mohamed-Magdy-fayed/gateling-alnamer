// Generates media/sample/lesson-sample.webm: a ~20 s animated test card recorded in the locally
// installed Playwright Chromium (canvas + MediaRecorder, VP8). Nothing is downloaded. Run once and
// commit the output: `node scripts/make-sample-video.mjs`.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const SECONDS = 20;
const OUT = path.resolve("media/sample/lesson-sample.webm");

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.setContent("<canvas id=c width=960 height=540></canvas>");
  const base64 = await page.evaluate(async (seconds) => {
    const canvas = document.getElementById("c");
    const ctx = canvas.getContext("2d");
    const stream = canvas.captureStream(25);
    const recorder = new MediaRecorder(stream, {
      mimeType: "video/webm;codecs=vp8",
      videoBitsPerSecond: 300_000,
    });
    const chunks = [];
    recorder.ondataavailable = (event) => chunks.push(event.data);
    const done = new Promise((resolve) => {
      recorder.onstop = resolve;
    });
    const start = performance.now();
    const draw = () => {
      const t = (performance.now() - start) / 1000;
      ctx.fillStyle = "#0f3d3e";
      ctx.fillRect(0, 0, 960, 540);
      ctx.fillStyle = "#e7c873";
      const x = 480 + Math.cos(t * 1.3) * 320;
      const y = 270 + Math.sin(t * 2.1) * 160;
      ctx.beginPath();
      ctx.arc(x, y, 36, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.textAlign = "center";
      ctx.font = "bold 48px sans-serif";
      ctx.fillText("درس تجريبي  ·  Sample lesson", 480, 120);
      ctx.font = "bold 96px monospace";
      ctx.fillText(`${Math.min(seconds, Math.floor(t))}`.padStart(2, "0"), 480, 450);
      if (t < seconds) requestAnimationFrame(draw);
      else recorder.stop();
    };
    recorder.start(1000);
    draw();
    await done;
    const blob = new Blob(chunks, { type: "video/webm" });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  }, SECONDS);
  mkdirSync(path.dirname(OUT), { recursive: true });
  const buffer = Buffer.from(base64, "base64");
  writeFileSync(OUT, buffer);
  console.log(`Wrote ${OUT} (${buffer.length} bytes).`);
} finally {
  await browser.close();
}
