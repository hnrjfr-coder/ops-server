import test from "node:test";
import assert from "node:assert/strict";
import { createCorsMiddleware, getAllowedOrigins } from "./cors.js";

function runMiddleware({ origin, method = "POST", allowedOrigins }) {
  const headers = {};
  const response = {
    vary: (value) => { headers.Vary = value; },
    header: (name, value) => { headers[name] = value; },
    sendStatus: (status) => { response.status = status; return response; },
  };
  let nextCalled = false;
  createCorsMiddleware(allowedOrigins)(
    { headers: origin ? { origin } : {}, method },
    response,
    () => { nextCalled = true; },
  );
  return { headers, status: response.status, nextCalled };
}

test("CLIENT_ORIGIN accepts a comma-separated list and canonicalizes trailing slashes", () => {
  const origins = getAllowedOrigins("https://opshub.ng/, https://www.opshub.ng");

  assert.deepEqual([...origins], ["https://opshub.ng", "https://www.opshub.ng"]);
});

test("CLIENT_ORIGIN rejects paths, invalid origins, and an empty allowlist", () => {
  assert.throws(() => getAllowedOrigins("https://opshub.ng/app"), /origins only/);
  assert.throws(() => getAllowedOrigins("not a URL"), /invalid origin/);
  assert.throws(() => getAllowedOrigins(" , "), /at least one allowed origin/);
});

test("allowed preflight returns the requesting configured origin and required headers", () => {
  const result = runMiddleware({
    origin: "https://www.opshub.ng",
    method: "OPTIONS",
    allowedOrigins: getAllowedOrigins("https://opshub.ng,https://www.opshub.ng"),
  });

  assert.equal(result.status, 204);
  assert.equal(result.nextCalled, false);
  assert.equal(result.headers["Access-Control-Allow-Origin"], "https://www.opshub.ng");
  assert.equal(result.headers["Access-Control-Allow-Headers"], "Content-Type, Authorization");
  assert.match(result.headers["Access-Control-Allow-Methods"], /POST/);
  assert.equal(result.headers.Vary, "Origin");
});

test("disallowed preflight is rejected without reflecting or substituting an origin", () => {
  const result = runMiddleware({
    origin: "https://www.opshub.ng",
    method: "OPTIONS",
    allowedOrigins: getAllowedOrigins("http://opshub.ng"),
  });

  assert.equal(result.status, 403);
  assert.equal(result.nextCalled, false);
  assert.equal(result.headers["Access-Control-Allow-Origin"], undefined);
  assert.equal(result.headers.Vary, "Origin");
});

test("disallowed normal request receives no CORS permission header", () => {
  const result = runMiddleware({
    origin: "https://unrelated.example",
    allowedOrigins: getAllowedOrigins("https://opshub.ng,https://www.opshub.ng"),
  });

  assert.equal(result.status, undefined);
  assert.equal(result.nextCalled, true);
  assert.equal(result.headers["Access-Control-Allow-Origin"], undefined);
});
