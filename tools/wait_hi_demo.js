"use strict";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const delayArg = process.argv[2];
  const delayMs = Number.isFinite(Number(delayArg)) ? Math.max(0, Number(delayArg)) : 1000;
  await sleep(delayMs);
  process.stdout.write("hi\n");
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message || String(error)}\n`);
    process.exit(1);
  });
}
