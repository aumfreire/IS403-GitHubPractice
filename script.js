/* Tiny Synth Sequencer — vanilla JS + Web Audio */

const ROWS = 4;
const COLS = 16;
const NOTES = ["C3", "E3", "G3", "C4"]; // kick-ish, snare-ish, hat-ish, lead-ish
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

let isMouseDown = false;
let isPlaying = false;
let currentStep = 0;
let scheduleTimer;
let lookahead = 25; // ms between scheduler runs
let scheduleAhead = 0.1; // seconds to schedule ahead in WebAudio time

const state = Array.from({ length: ROWS }, () =>
  Array.from({ length: COLS }, () => false)
);

// Build grid
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

// Mouse/touch painting
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
  // Single click toggle
  toggleCell(e.target, !e.target.classList.contains("active"));
});

function toggleCell(cell, on) {
  const r = +cell.dataset.row;
  const c = +cell.dataset.col;
  state[r][c] = on;
  cell.classList.toggle("active", on);
  cell.setAttribute("aria-pressed", on ? "true" : "false");
  // Tap-to-preview sound
  if (on) {
    playNoteOnce(NOTES[r], 0.06);
  }
}

// Controls
bpmEl.addEventListener("input", () => {
  bpmValEl.textContent = bpmEl.value;
});
swingEl.addEventListener("input", () => {
  swingValEl.textContent = `${swingEl.value}%`;
});

playBtn.addEventListener("click", () => togglePlay(true));
stopBtn.addEventListener("click", () => togglePlay(false));
clearBtn.addEventListener("click", () => clearGrid());
randomBtn.addEventListener("click", () => randomizeGrid());

// Keyboard shortcuts
document.addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
  if (e.code === "Space") {
    e.preventDefault();
    togglePlay(!isPlaying);
  } else if (e.key.toLowerCase() === "c") {
    clearGrid();
  } else if (e.key.toLowerCase() === "r") {
    randomizeGrid();
  }
});

// Audio setup
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
  // Supports like "C3", "E4", etc.
  const A4 = 440;
  const SEMI = 69; // MIDI note number for A4
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
  const n = map[p] + (parseInt(octStr, 10) + 1) * 12; // MIDI number
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

  // Clickless envelope
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.8, t + 0.006);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);

  osc.connect(gain);
  gain.connect(masterGain);
  osc.start(t);
  osc.stop(t + duration + 0.02);
}

// Simple drum flavors via short envelopes on lower notes
function playStep(row, stepTime) {
  const note = NOTES[row];
  // Slightly different durations per row
  const dur = [0.12, 0.1, 0.06, 0.18][row];
  playNoteOnce(note, dur, stepTime - audioCtx.currentTime);
}

// Transport
let nextNoteTime = 0;
let stepIndex = 0;

function togglePlay(shouldPlay) {
  ensureAudio();
  if (shouldPlay && !isPlaying) {
    isPlaying = true;
    playBtn.textContent = "⏸ Pause";
    // If context is suspended (user gesture), resume
    audioCtx.resume();
    stepIndex = currentStep; // continue from current
    nextNoteTime = audioCtx.currentTime + 0.05;
    schedulerStart();
  } else if (!shouldPlay && isPlaying) {
    isPlaying = false;
    playBtn.textContent = "▶ Play";
    schedulerStop();
    setPlayhead(-1);
  } else if (shouldPlay && isPlaying) {
    // Toggle pause
    isPlaying = false;
    playBtn.textContent = "▶ Play";
    schedulerStop();
  } else {
    // resume from pause
    isPlaying = true;
    playBtn.textContent = "⏸ Pause";
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
  // Visual playhead
  setPlayhead(step);

  // Play active cells in this column
  for (let r = 0; r < ROWS; r++) {
    if (state[r][step]) {
      playStep(r, time);
    }
  }
}

function advanceStep() {
  const bpm = parseInt(bpmEl.value, 10);
  const secPerBeat = 60.0 / bpm;
  // 16 steps represent 4 beats => each step is a 16th note
  let stepDur = secPerBeat / 4;

  // Basic swing on even steps (push/pull)
  const swingPct = parseInt(swingEl.value, 10) / 100;
  if (stepIndex % 2 === 1) {
    stepDur *= 1 + 0.5 * swingPct;
  } else {
    stepDur *= 1 - 0.5 * swingPct;
  }

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
    const cell = gridEl.children[idx];
    cell.classList.add("playhead");
  }
}

function clearGrid() {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      state[r][c] = false;
    }
  }
  document
    .querySelectorAll(".cell")
    .forEach((el) => el.classList.remove("active"));
}

function randomizeGrid() {
  // bias per row to make it musical-ish
  const probs = [0.35, 0.25, 0.45, 0.2];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const on = Math.random() < probs[r];
      state[r][c] = on;
    }
  }
  renderState();
}

function renderState() {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const idx = r * COLS + c;
      const cell = gridEl.children[idx];
      cell.classList.toggle("active", state[r][c]);
      cell.setAttribute("aria-pressed", state[r][c] ? "true" : "false");
    }
  }
}

// Seed a pleasant default groove
(function seedPattern() {
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

// Nice little accessibility touch: announce BPM and Swing changes
bpmEl.addEventListener("change", () => {
  bpmValEl.textContent = bpmEl.value;
});
swingEl.addEventListener("change", () => {
  swingValEl.textContent = `${swingEl.value}%`;
});
