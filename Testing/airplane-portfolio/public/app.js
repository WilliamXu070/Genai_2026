const plane = document.getElementById("plane");
const flightPath = document.getElementById("flight-path-line");
const heroSection = document.querySelector(".hero");
const panels = Array.from(document.querySelectorAll(".story-panel"));
const progressReadout = document.getElementById("progress-readout");
const activeLabel = document.getElementById("active-label");

const state = {
  targetProgress: 0,
  progress: 0,
  progressVelocity: 0,
  rotation: -24,
  rotationVelocity: 0,
  lastFrameTimeMs: null
};

const pathLength = flightPath ? flightPath.getTotalLength() : 0;
const PROGRESS_STIFFNESS = 18;
const PROGRESS_DAMPING = 7;
const ROTATION_STIFFNESS = 22;
const ROTATION_DAMPING = 8;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function shortestAngleDelta(fromDeg, toDeg) {
  let delta = (toDeg - fromDeg) % 360;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  return delta;
}

function stepSpring(value, velocity, target, stiffness, damping, dtSeconds) {
  const nextVelocity = velocity + (target - value) * stiffness * dtSeconds;
  const dampedVelocity = nextVelocity / (1 + damping * dtSeconds);
  const nextValue = value + dampedVelocity * dtSeconds;
  return { value: nextValue, velocity: dampedVelocity };
}

function getScrollProgress() {
  const maxScrollable = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
  return clamp(window.scrollY / maxScrollable, 0, 1);
}

function getPathMetrics(progress) {
  if (!flightPath) {
    return { x: 88, y: 608, rotation: -24 };
  }

  const clamped = clamp(progress, 0, 1);
  const currentLength = pathLength * clamped;
  const sampleWindow = Math.max(10, pathLength * 0.018);
  const beforeLength = Math.max(0, currentLength - sampleWindow);
  const afterLength = Math.min(pathLength, currentLength + sampleWindow);
  const point = flightPath.getPointAtLength(currentLength);
  const before = flightPath.getPointAtLength(beforeLength);
  const after = flightPath.getPointAtLength(afterLength);
  const dx = after.x - before.x;
  const dy = after.y - before.y;
  const rotation = Math.atan2(dy, dx) * (180 / Math.PI);

  return { x: point.x, y: point.y, rotation };
}

function updateActivePanel(progress) {
  if (panels.length === 0) {
    return;
  }

  const scaled = clamp(progress, 0, 0.9999) * panels.length;
  const activeIndex = clamp(Math.floor(scaled), 0, panels.length - 1);

  panels.forEach((panel, index) => {
    const focus = 1 - clamp(Math.abs(index - (progress * (panels.length - 1))), 0, 1);
    panel.classList.toggle("is-active", index === activeIndex);
    panel.style.setProperty("--panel-focus", focus.toFixed(3));
  });

  const activePanel = panels[activeIndex];
  if (activeLabel && activePanel) {
    activeLabel.textContent = activePanel.dataset.label || activePanel.querySelector("h3")?.textContent || "Route";
  }
}

function updateSectionTransition() {
  const heroHeight = Math.max(heroSection?.offsetHeight || 1, window.innerHeight * 0.8);
  const approach = clamp(window.scrollY / heroHeight, 0, 1);
  document.documentElement.style.setProperty("--hero-progress", approach.toFixed(3));
}

function renderScene(metrics) {
  const { x, y } = metrics;

  if (plane) {
    plane.style.setProperty("--plane-x", `${x}px`);
    plane.style.setProperty("--plane-y", `${y}px`);
    plane.style.setProperty("--plane-rot", `${state.rotation.toFixed(2)}deg`);
  }

  if (progressReadout) {
    progressReadout.textContent = `${Math.round(state.progress * 100)}%`;
  }

  updateActivePanel(state.progress);
}

function animate(frameTimeMs) {
  if (state.lastFrameTimeMs === null) {
    state.lastFrameTimeMs = frameTimeMs;
  }

  const dtSeconds = clamp((frameTimeMs - state.lastFrameTimeMs) / 1000, 0.001, 0.04);
  state.lastFrameTimeMs = frameTimeMs;

  const progressStep = stepSpring(
    state.progress,
    state.progressVelocity,
    state.targetProgress,
    PROGRESS_STIFFNESS,
    PROGRESS_DAMPING,
    dtSeconds
  );
  state.progress = clamp(progressStep.value, 0, 1);
  state.progressVelocity = progressStep.velocity;

  const metrics = getPathMetrics(state.progress);
  const targetRotation = metrics.rotation;
  const targetRotationValue = state.rotation + shortestAngleDelta(state.rotation, targetRotation);
  const rotationStep = stepSpring(
    state.rotation,
    state.rotationVelocity,
    targetRotationValue,
    ROTATION_STIFFNESS,
    ROTATION_DAMPING,
    dtSeconds
  );
  state.rotation = rotationStep.value;
  state.rotationVelocity = rotationStep.velocity;

  updateSectionTransition();
  renderScene(metrics);
  requestAnimationFrame(animate);
}

function handleScrollLikeInput() {
  state.targetProgress = getScrollProgress();
}

window.addEventListener("scroll", handleScrollLikeInput, { passive: true });
window.addEventListener("resize", handleScrollLikeInput);

handleScrollLikeInput();
updateSectionTransition();
renderScene(getPathMetrics(state.progress));
requestAnimationFrame(animate);
