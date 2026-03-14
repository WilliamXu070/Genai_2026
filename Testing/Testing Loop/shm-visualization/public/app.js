const canvas = document.getElementById("shm-canvas");
const ctx = canvas.getContext("2d");
const toggleBtn = document.getElementById("toggle-sim");
const resetBtn = document.getElementById("reset-sim");
const posReadout = document.getElementById("pos-readout");
const velReadout = document.getElementById("vel-readout");
const keReadout = document.getElementById("ke-readout");
const peReadout = document.getElementById("pe-readout");
const energyReadout = document.getElementById("energy-readout");

const m = 1;
const k = 0.035;
const omega = Math.sqrt(k / m);
const amplitude = 200;
const uiUpdateIntervalMs = 1000 / 12;
const startEaseDurationMs = 220;

let running = false;
let simulationTime = 0;
let phase = 0;
let x = amplitude;
let v = 0;
let lastFrameTimeMs = null;
let lastUiUpdateMs = -Infinity;
let startRamp = 1;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function updatePhysics(dtSeconds) {
  simulationTime += dtSeconds * startRamp;
  const angle = omega * simulationTime + phase;
  x = amplitude * Math.cos(angle);
  v = -amplitude * omega * Math.sin(angle) * startRamp;
}

function updateReadouts() {
  const ke = 0.5 * m * v * v;
  const pe = 0.5 * k * x * x;
  const total = ke + pe;
  posReadout.textContent = x.toFixed(2);
  velReadout.textContent = v.toFixed(2);
  keReadout.textContent = ke.toFixed(2);
  peReadout.textContent = pe.toFixed(2);
  energyReadout.textContent = total.toFixed(2);
}

function drawSpring(baseX, baseY, bobX) {
  const length = bobX - baseX;
  const restLength = 360;
  const normalizedStretch = clamp((length - restLength) / restLength, -0.45, 0.6);
  const coils = Math.round(18 - normalizedStretch * 4);
  const points = coils * 14;
  const radius = 13 - normalizedStretch * 4;
  const depth = 5;
  const highlightOffset = 2.2;

  ctx.beginPath();
  for (let i = 0; i <= points; i += 1) {
    const t = i / points;
    const turn = t * Math.PI * 2 * coils;
    const px = baseX + length * t + Math.cos(turn) * depth * 0.4;
    const py = baseY + Math.sin(turn) * radius;
    if (i === 0) {
      ctx.moveTo(px, py);
    } else {
      ctx.lineTo(px, py);
    }
  }
  ctx.strokeStyle = "#2b4fd0";
  ctx.lineWidth = 4;
  ctx.stroke();

  ctx.beginPath();
  for (let i = 0; i <= points; i += 1) {
    const t = i / points;
    const turn = t * Math.PI * 2 * coils;
    const px = baseX + length * t + Math.cos(turn) * depth * 0.4;
    const py = baseY + Math.sin(turn) * radius - highlightOffset;
    if (i === 0) {
      ctx.moveTo(px, py);
    } else {
      ctx.lineTo(px, py);
    }
  }
  ctx.strokeStyle = "rgba(255, 255, 255, 0.7)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function drawScene() {
  const centerY = canvas.height / 2;
  const anchorX = 130;
  const equilibriumX = 490;
  const bobX = equilibriumX + x;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = "rgba(30, 50, 100, 0.2)";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 5]);
  ctx.beginPath();
  ctx.moveTo(equilibriumX, 32);
  ctx.lineTo(equilibriumX, canvas.height - 32);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = "#6a6f7a";
  ctx.fillRect(anchorX - 10, centerY - 64, 20, 128);

  drawSpring(anchorX, centerY, bobX - 24);

  const bobGradient = ctx.createRadialGradient(bobX - 9, centerY - 9, 5, bobX, centerY, 27);
  bobGradient.addColorStop(0, "#ff9a9a");
  bobGradient.addColorStop(1, "#b41111");
  ctx.beginPath();
  ctx.arc(bobX, centerY, 26, 0, Math.PI * 2);
  ctx.fillStyle = bobGradient;
  ctx.fill();
  ctx.strokeStyle = "#402020";
  ctx.lineWidth = 2;
  ctx.stroke();
}

function render(frameTimeMs) {
  if (lastFrameTimeMs === null) {
    lastFrameTimeMs = frameTimeMs;
  }
  const dtSeconds = clamp((frameTimeMs - lastFrameTimeMs) / 1000, 0, 0.05);
  lastFrameTimeMs = frameTimeMs;

  if (running) {
    startRamp = clamp(startRamp + dtSeconds / (startEaseDurationMs / 1000), 0, 1);
    updatePhysics(dtSeconds);
  }

  drawScene();

  if (frameTimeMs - lastUiUpdateMs >= uiUpdateIntervalMs || !running) {
    updateReadouts();
    lastUiUpdateMs = frameTimeMs;
  }

  requestAnimationFrame(render);
}

function resetSimulation() {
  simulationTime = 0;
  phase = 0;
  x = amplitude;
  v = 0;
  startRamp = running ? 0 : 1;
  lastUiUpdateMs = -Infinity;
}

toggleBtn.addEventListener("click", () => {
  running = !running;
  if (running) {
    lastFrameTimeMs = null;
    startRamp = 0;
  }
});

resetBtn.addEventListener("click", () => {
  resetSimulation();
  updateReadouts();
});

resetSimulation();
updateReadouts();
requestAnimationFrame(render);
