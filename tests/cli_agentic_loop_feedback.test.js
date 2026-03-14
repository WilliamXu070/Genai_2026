const assert = require("node:assert");
const { toFixPacket } = require("../Testing/cli_agentic_loop/feedback");

(() => {
  const packet = toFixPacket(
    {
      final_verdict: "pass",
      execution: { status: "pass", artifacts: ["C:\\tmp\\a.webm"] },
      critique: { overall_severity: 2, summary: "ok", defects: [], recommendations: [] }
    },
    1
  );
  assert.equal(packet.needsFix, false);
  assert.equal(packet.verdict, "pass");
})();

(() => {
  const packet = toFixPacket(
    {
      final_verdict: "fail",
      escalated: true,
      execution: { status: "fail", summary: "selector timeout", artifacts: [] },
      critique: {
        overall_severity: 9,
        summary: "critical issues",
        defects: [
          { id: "a", severity_0_10: 4, recommendation: "fix a" },
          { id: "b", severity_0_10: 9, recommendation: "fix b" }
        ],
        recommendations: ["fix b", "fix a"]
      }
    },
    2
  );
  assert.equal(packet.needsFix, true);
  assert.equal(packet.topDefects[0].id, "b");
  assert.match(packet.codexInstruction, /overall severity: 9/i);
})();

console.log("cli_agentic_loop_feedback.test.js passed");
