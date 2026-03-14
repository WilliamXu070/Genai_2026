const canvas = document.getElementById("shm-canvas");
const ctx = canvas.getContext("2d");
const toggleBtn = document.getElementById("toggle-sim");
const resetBtn = document.getElementById("reset-sim");
const posReadout = document.getElementById("pos-readout");
const velReadout = document.getElementById("vel-readout");
const keReadout = document.getElementById("ke-readout");
const peReadout = document.getElementById("pe-readout");
const energyReadout = document.getElementById("energy-readout");

let running = false;
let x = 200;
let v = 0;
const m = 1;
const k = 0.035;
const omega = Math.sqrt(k / m);
const amplitude = 200;
let phase = 0;
let simulationTime = 0;
let lastFrameTime = null;

function updateState(dtSeconds) {
  simulationTime += dtSeconds;
  const angle = omega * simulationTime + phase;
  x = amplitude * Math.cos(angle);
  v = -amplitude * omega * Math.sin(angle);
}

function updateReadouts() {
  const kineticEnergy = 0.5 * m * v * v;
  const potentialEnergy = 0.5 * k * x * x;
  const energy = kineticEnergy + potentialEnergy;
  posReadout.textContent = x.toFixed(2);
  velReadout.textContent = v.toFixed(2);
  if (keReadout) {
    keReadout.textContent = kineticEnergy.toFixed(2);
  }
  if (peReadout) {
    peReadout.textContent = potentialEnergy.toFixed(2);
  }
  energyReadout.textContent = energy.toFixed(2);
}

function drawSpring(baseX, baseY, bobX) {
  const length = bobX - baseX;
  const coilCount = 18;
  const points = coilCount * 12;
  const amplitudePx = 16;
  const restLength = 360;
  const compression = Math.max(0, (restLength - length) / restLength);
  const lineWidth = 3 + compression * 1.4;

  ctx.beginPath();
  ctx.moveTo(baseX, baseY);
  for (let i = 1; i < points; i += 1) {
    const t = i / points;
    const px = baseX + length * t;
    const py = baseY + Math.sin(t * Math.PI * 2 * coilCount) * amplitudePx;
    ctx.lineTo(px, py);
  }
  ctx.lineTo(bobX, baseY);
  ctx.strokeStyle = "#2343af";
  ctx.lineWidth = lineWidth;
  ctx.stroke();
}

function render(frameTimeMs) {
  if (lastFrameTime === null) {
    lastFrameTime = frameTimeMs;
  }
  const elapsedMs = frameTimeMs - lastFrameTime;
  const dtSeconds = Math.min(0.05, Math.max(0, elapsedMs / 1000));
  lastFrameTime = frameTimeMs;

  if (running) {
    updateState(dtSeconds);
  }

  const centerY = canvas.height / 2;
  const anchorX = 140;
  const equilibriumX = 500;
  const bobX = equilibriumX + x;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "#555";
  ctx.fillRect(anchorX - 10, centerY - 60, 20, 120);
  drawSpring(anchorX, centerY, bobX);

  ctx.beginPath();
  ctx.arc(bobX, centerY, 26, 0, Math.PI * 2);
  ctx.fillStyle = "#d32929";
  ctx.fill();
  ctx.strokeStyle = "#222";
  ctx.lineWidth = 2;
  ctx.stroke();

  updateReadouts();
  requestAnimationFrame(render);
}

toggleBtn.addEventListener("click", () => {
  running = !running;
  if (running) {
    lastFrameTime = null;
  }
});

resetBtn.addEventListener("click", () => {
  simulationTime = 0;
  phase = 0;
  x = amplitude;
  v = 0;
  lastFrameTime = null;
  updateReadouts();
});

updateReadouts();
requestAnimationFrame(render);
