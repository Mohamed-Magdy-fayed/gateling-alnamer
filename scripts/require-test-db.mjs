// Fails fast with a clear message when the db-test container is not reachable (used by `npm run verify`).
import net from "node:net";
import { DEFAULT_TEST_DATABASE_URL } from "./lib/local-env.mjs";

const url = new URL(process.env.TEST_DATABASE_URL || DEFAULT_TEST_DATABASE_URL);
const socket = net.connect({ host: url.hostname, port: Number(url.port || 5432) });
const fail = () => {
  console.error(
    `verify: the test database is not reachable at ${url.hostname}:${url.port}. Start Docker, then run: npm run db:up`,
  );
  process.exit(1);
};
socket.setTimeout(3000, fail);
socket.on("error", fail);
socket.on("connect", () => {
  socket.end();
  process.exit(0);
});
