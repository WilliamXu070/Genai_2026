const assert = require("node:assert");
const {
  buildSignalFingerprint,
  hasRepeatedSignal
} = require("../Testing/Testing Loop/orchestrate_testing");

(() => {
  const orchestration = {
    final_verdict: "fail",
    escalated: true,
    critique: {
      summary: "Hero section is blank and the scroll animation never moves.",
      defects: [
        { id: "hero_blank", description: "Hero section is blank" },
        { id: "plane_static", description: "Airplane never moves" }
      ]
    },
    execution: {
      status: "fail",
      summary: "The page loaded but the core animated route stayed static."
    }
  };
  const fixPacket = {
    verdict: "fail",
    executionStatus: "fail",
    escalated: true,
    summary: "Hero section is blank and the scroll animation never moves.",
    topDefects: [
      { id: "hero_blank" },
      { id: "plane_static" }
    ]
  };

  const fingerprintA = buildSignalFingerprint(orchestration, fixPacket);
  const fingerprintB = buildSignalFingerprint(orchestration, fixPacket);
  assert.equal(hasRepeatedSignal(fingerprintA, fingerprintB), true);
})();

(() => {
  const first = buildSignalFingerprint(
    {
      final_verdict: "fail",
      critique: { summary: "Plane does not animate.", defects: [{ id: "plane_static" }] },
      execution: { status: "fail", summary: "Route is frozen." }
    },
    {
      verdict: "fail",
      executionStatus: "fail",
      summary: "Plane does not animate.",
      topDefects: [{ id: "plane_static" }]
    }
  );

  const second = buildSignalFingerprint(
    {
      final_verdict: "fail",
      critique: { summary: "CTA is off screen.", defects: [{ id: "cta_hidden" }] },
      execution: { status: "fail", summary: "Landing CTA is not visible." }
    },
    {
      verdict: "fail",
      executionStatus: "fail",
      summary: "CTA is off screen.",
      topDefects: [{ id: "cta_hidden" }]
    }
  );

  assert.equal(hasRepeatedSignal(first, second), false);
})();

console.log("orchestrate_testing_signals.test.js passed");
