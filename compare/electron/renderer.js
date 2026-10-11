// Vanilla DOM (no framework): the cheapest possible way to drive this scene in Electron.
// Electron passes the scene options in the query string; the Tauri shell injects __BENCH_PARAMS__.
const params = new URLSearchParams(window.__BENCH_PARAMS__ ?? location.search);
// Tauri doesn't forward console.log to the terminal, so lines also go to its `report` command.
const report = (line) => (console.log(line), window.__TAURI__?.core.invoke("report", { line }));
const N = Number(params.get("N"));
const MODE = params.get("MODE");
const MIN_INTERVAL = 1000 / Number(params.get("MAX_FPS")) - 1.5; // same cap rule as nodebuilder
const COLS = 10;
const hue = ["#e8f0fe", "#fde8e8", "#e6f4ea", "#fef7e0"];

const title = document.getElementById("title");
const scroll = document.getElementById("scroll");
const labels = [];
let row;
for (let i = 0; i < N; i++) {
  if (i % COLS === 0) scroll.appendChild((row = document.createElement("div"))).className = "row";
  const cell = row.appendChild(document.createElement("div"));
  cell.className = "cell";
  cell.style.background = hue[i % 4];
  cell.textContent = `#${i}`;
  labels.push(cell);
}

let tick = 0;
let last = -Infinity;
let frames = 0;
let jsTime = 0;
let since = performance.now();
title.textContent = "Frame 0";

function frame(now) {
  requestAnimationFrame(frame);
  if (now - last < MIN_INTERVAL) return;
  last = now;
  const t0 = performance.now();
  tick++;
  title.textContent = `Frame ${tick}`;
  if (MODE === "all") for (let i = 0; i < N; i++) labels[i].textContent = `#${i} · ${(tick + i) % 1000}`;
  jsTime += performance.now() - t0;
  frames++;
  if (now - since >= 1000) {
    report(`fps ${Math.round((frames * 1000) / (now - since))} | js ${(jsTime / frames).toFixed(2)} ms/frame`);
    frames = 0;
    jsTime = 0;
    since = now;
  }
}
if (MODE !== "static") requestAnimationFrame(frame);
