// Benchmarks argon2id at the OWASP parameters. Target: 150-400 ms median per hash.
import { hash } from "@node-rs/argon2";

const OPTIONS = { algorithm: 2, memoryCost: 19456, timeCost: 2, parallelism: 1 };
const RUNS = 10;

await hash("warm-up", OPTIONS);
const times = [];
for (let i = 0; i < RUNS; i += 1) {
  const start = performance.now();
  await hash(`bench-password-${i}`, OPTIONS);
  times.push(performance.now() - start);
}
times.sort((a, b) => a - b);
const median = (times[RUNS / 2 - 1] + times[RUNS / 2]) / 2;
console.log(
  `argon2id m=${OPTIONS.memoryCost} t=${OPTIONS.timeCost} p=${OPTIONS.parallelism}: ` +
    `median ${median.toFixed(0)} ms, min ${times[0].toFixed(0)} ms, max ${times[RUNS - 1].toFixed(0)} ms (${RUNS} runs)`,
);
if (median < 150 || median > 400) console.log("WARNING: median outside the 150-400 ms target.");
