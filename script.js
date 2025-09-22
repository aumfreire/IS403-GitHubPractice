/* UI polish + Theme toggle + your original sequencer logic */

const ROWS = 4;
const COLS = 16;
const NOTES = ["C3", "E3", "G3", "C4"];

const gridEl = document.getElementById("grid");
const bpmEl = document.getElementById("bpm");
const bpmValEl = document.getElementById("bpmVal");
const waveEl = document.getElementById("wave");
const swingEl = document.getElementById("swing");
const swingValEl = document.getElementById("swingVal");
const playBtn = document.getElementById("playBtn");
const stopBtn = document.getElementById("stopBtn");
const clearBtn = document.getElementById("clearBtn");
const randomBtn = document.getElementById("randomBtn");
const themeBtn = document.getElementById("themeBtn");

let isMouseDown = false;
let isPlaying = false;
let currentStep = 0;
let scheduleTimer;
let lookahead = 25;
let scheduleAhead = 0.1;

const state = Array.from({ length: ROWS }, () =>
  Array.from({ length: COLS }, () => false)
);

// --------- Theme toggle (saved) ----------
const root = document.documentElement;
const savedTheme = localStorage.getItem("ts-theme");
if (savedTheme === "light") root.classList.add("light");
themeBtn?.addEventListener("click", () => {
  root.classList.toggle("light");
  localStorage.setItem(
    "ts-theme",
    root.classList.contains("light") ? "light" : "dark"
  );
});

// --------- Build grid ----------
function buildGrid() {
  gridEl.style.setProperty("--cols", COLS);
  gridEl.innerHTML = "";
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const cell = document.createElement("button");
      cell.className = "cell";
      cell.setAttribute("role", "gridcell");
      cell.setAttribute("aria-pressed", "false");
      cell.dataset.row = r;
      cell.dataset.col = c;
      gridEl.appendChild(cell);
    }
  }
}
buildGrid();

// Painting
gridEl.addEventListener("mousedown", (e) => {
  if (
    !(e.target instanceof HTMLElement) ||
    !e.target.classList.contains("cell")
  )
    return;
  isMouseDown = true;
  toggleCell(e.target, !e.target.classList.contains("active"));
});
gridEl.addEventListener("mouseover", (e) => {
  if (!isMouseDown) return;
  if (
    !(e.target instanceof HTMLElement) ||
    !e.target.classList.contains("cell")
  )
    return;
  toggleCell(e.target, true);
});
document.addEventListener("mouseup", () => (isMouseDown = false));
gridEl.addEventListener("click", (e) => {
  if (
    !(e.target instanceof HTMLElement) ||
    !e.target.classList.contains("cell")
  )
    return;
  toggleCell(e.target, !e.target.classList.contains("active"));
});

function toggleCell(cell, on) {
  const r = +cell.dataset.row;
  const c = +cell.dataset.col;
  state[r][c] = on;
  cell.classList.toggle("active", on);
  cell.setAttribute("aria-pressed", on ? "true" : "false");
  if (on) playNoteOnce(NOTES[r], 0.06);
}

// Controls
bpmEl.addEventListener("input", () => (bpmValEl.textContent = bpmEl.value));
swingEl.addEventListener(
  "input",
  () => (swingValEl.textContent = `${swingEl.value}%`)
);

playBtn.addEventListener("click", () => togglePlay(true));
stopBtn.addEventListener("click", () => togglePlay(false));
clearBtn.addEventListener("click", () => clearGrid());
randomBtn.addEventListener("click", () => randomizeGrid());

// Keyboard
document.addEventListener("keydown", (e) => {
  if (["INPUT", "SELECT", "TEXTAREA"].includes(e.target.tagName)) return;
  if (e.code === "Space") {
    e.preventDefault();
    togglePlay(!isPlaying);
  } else if (e.key.toLowerCase() === "c") {
    clearGrid();
  } else if (e.key.toLowerCase() === "r") {
    randomizeGrid();
  }
});

// Audio
let audioCtx, masterGain;
function ensureAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = 0.9;
    masterGain.connect(audioCtx.destination);
  }
}
function freqFromNote(note) {
  const A4 = 440,
    SEMI = 69;
  const map = {
    C: 0,
    "C#": 1,
    Db: 1,
    D: 2,
    "D#": 3,
    Eb: 3,
    E: 4,
    F: 5,
    "F#": 6,
    Gb: 6,
    G: 7,
    "G#": 8,
    Ab: 8,
    A: 9,
    "A#": 10,
    Bb: 10,
    B: 11,
  };
  const m = note.match(/^([A-G]#?|Bb|Db|Gb)(\d)$/);
  if (!m) return A4;
  const [, p, octStr] = m;
  const n = map[p] + (parseInt(octStr, 10) + 1) * 12;
  const semisFromA4 = n - SEMI;
  return A4 * Math.pow(2, semisFromA4 / 12);
}
function playNoteOnce(note, duration = 0.08, when = 0) {
  ensureAudio();
  const t = audioCtx.currentTime + (when || 0);
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();

  osc.type = waveEl.value;
  osc.frequency.value = freqFromNote(note);

  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.8, t + 0.006);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);

  osc.connect(gain);
  gain.connect(masterGain);
  osc.start(t);
  osc.stop(t + duration + 0.02);
}
function playStep(row, time) {
  const dur = [0.12, 0.1, 0.06, 0.18][row];
  playNoteOnce(NOTES[row], dur, time - audioCtx.currentTime);
}

// Transport
let nextNoteTime = 0;
let stepIndex = 0;

function togglePlay(shouldPlay) {
  ensureAudio();
  const body = document.body;
  if (shouldPlay && !isPlaying) {
    isPlaying = true;
    body.classList.add("playing");
    playBtn.innerHTML = `<span class="dot dot-play"></span> Pause`;
    audioCtx.resume();
    stepIndex = currentStep;
    nextNoteTime = audioCtx.currentTime + 0.05;
    schedulerStart();
  } else if (!shouldPlay && isPlaying) {
    isPlaying = false;
    body.classList.remove("playing");
    playBtn.innerHTML = `<span class="dot dot-play"></span> Play`;
    schedulerStop();
    setPlayhead(-1);
  } else if (shouldPlay && isPlaying) {
    isPlaying = false;
    body.classList.remove("playing");
    playBtn.innerHTML = `<span class="dot dot-play"></span> Play`;
    schedulerStop();
  } else {
    isPlaying = true;
    body.classList.add("playing");
    playBtn.innerHTML = `<span class="dot dot-play"></span> Pause`;
    audioCtx.resume();
    nextNoteTime = audioCtx.currentTime + 0.05;
    schedulerStart();
  }
}

function schedulerStart() {
  scheduleTimer = setInterval(() => {
    while (audioCtx.currentTime + scheduleAhead >= nextNoteTime) {
      scheduleStep(stepIndex, nextNoteTime);
      advanceStep();
    }
  }, lookahead);
}
function schedulerStop() {
  clearInterval(scheduleTimer);
}

function scheduleStep(step, time) {
  setPlayhead(step);
  for (let r = 0; r < ROWS; r++) if (state[r][step]) playStep(r, time);
}
function advanceStep() {
  const bpm = parseInt(bpmEl.value, 10);
  const secPerBeat = 60.0 / bpm;
  let stepDur = secPerBeat / 4; // 16th
  const swingPct = parseInt(swingEl.value, 10) / 100;
  stepDur *= stepIndex % 2 === 1 ? 1 + 0.5 * swingPct : 1 - 0.5 * swingPct;
  nextNoteTime += stepDur;
  stepIndex = (stepIndex + 1) % COLS;
  currentStep = stepIndex;
}
function setPlayhead(step) {
  document
    .querySelectorAll(".cell")
    .forEach((el) => el.classList.remove("playhead"));
  if (step < 0) return;
  for (let r = 0; r < ROWS; r++) {
    const idx = r * COLS + step;
    gridEl.children[idx].classList.add("playhead");
  }
}

// State helpers
function clearGrid() {
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) state[r][c] = false;
  document
    .querySelectorAll(".cell")
    .forEach((el) => el.classList.remove("active"));
}
function randomizeGrid() {
  const probs = [0.35, 0.25, 0.45, 0.2];
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) state[r][c] = Math.random() < probs[r];
  renderState();
}
function renderState() {
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) {
      const idx = r * COLS + c;
      const cell = gridEl.children[idx];
      cell.classList.toggle("active", state[r][c]);
      cell.setAttribute("aria-pressed", state[r][c] ? "true" : "false");
    }
}

// Seed starter groove
(function seed() {
  const kick = 0,
    snare = 1,
    hat = 2,
    lead = 3;
  [0, 4, 8, 12].forEach((c) => (state[kick][c] = true));
  [4, 12].forEach((c) => (state[snare][c] = true));
  for (let c = 0; c < COLS; c++)
    if (c % 2 === 0) state[hat][c] = Math.random() > 0.2;
  [2, 7, 10, 15].forEach((c) => (state[lead][c] = Math.random() > 0.4));
  renderState();
})();
