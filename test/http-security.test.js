const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createRateLimiter, makeOriginGuard, noStore, makeAuth, roleGuard, errorStatus,
} = require("../lib/http-security");

function fakeResponse() {
  const headers = {};
  return {
    statusCode: 200,
    body: null,
    headers,
    set(key, value) { headers[key.toLowerCase()] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test("noStore marks token-bearing responses uncacheable", () => {
  const response = fakeResponse();
  let called = false;
  noStore({}, response, () => { called = true; });
  assert.equal(called, true);
  assert.match(response.headers["cache-control"], /no-store/);
  assert.equal(response.headers.pragma, "no-cache");
});

test("roleGuard has no privilege fallback", () => {
  const forbidden = fakeResponse();
  roleGuard("super_admin")({ admin: {} }, forbidden, () => assert.fail("should not pass"));
  assert.equal(forbidden.statusCode, 403);

  const allowed = fakeResponse();
  let passed = false;
  roleGuard("super_admin", "admin")({ admin: { role: "admin" } }, allowed, () => { passed = true; });
  assert.equal(passed, true);
  assert.equal(allowed.statusCode, 200);
});

test("makeAuth loads the current role from storage on every request", async () => {
  const loadAdmin = async () => ({ id: "a1", email: "a@example.com", role: "admin" });
  const auth = makeAuth({ jwtSecret: "secret", verify: () => ({ id: "a1", jti: "j1" }), loadAdmin });
  const request = { headers: { authorization: "Bearer token" } };
  const response = fakeResponse();
  let nextCalled = false;
  await new Promise(resolve => auth(request, response, () => { nextCalled = true; resolve(); }));
  assert.equal(nextCalled, true);
  assert.equal(request.admin.role, "admin");
  assert.equal(request.admin.email, "a@example.com");
});

test("makeAuth rejects deleted admins and revoked JWTs", async () => {
  const deleted = makeAuth({ jwtSecret: "s", verify: () => ({ sub: "gone" }), loadAdmin: async () => null });
  const responseA = fakeResponse();
  await deleted({ headers: {} }, responseA, () => assert.fail("deleted admin passed"));
  assert.equal(responseA.statusCode, 401);

  const revoked = makeAuth({
    jwtSecret: "s",
    verify: () => ({ sub: "a1", jti: "j-revoked" }),
    isRevoked: async jti => jti === "j-revoked",
    loadAdmin: async () => ({ id: "a1", role: "super_admin" }),
  });
  const responseB = fakeResponse();
  await revoked({ headers: {} }, responseB, () => assert.fail("revoked token passed"));
  assert.equal(responseB.statusCode, 401);
});

test("originGuard fails closed on mutations, but never breaks reads", () => {
  const read = fakeResponse();
  let readPassed = false;
  makeOriginGuard({ isProduction: true })(
    { method: "GET", headers: {} }, read, () => { readPassed = true; }
  );
  assert.equal(readPassed, true);
  assert.equal(read.statusCode, 200);

  const missing = fakeResponse();
  makeOriginGuard({ isProduction: true })(
    { method: "POST", headers: {} }, missing, () => assert.fail("should fail")
  );
  assert.equal(missing.statusCode, 503);

  const bad = fakeResponse();
  makeOriginGuard({ frontendOrigin: "https://kulkirti.in", isProduction: true })(
    { method: "POST", headers: { origin: "https://evil.test" } }, bad, () => assert.fail("should fail")
  );
  assert.equal(bad.statusCode, 403);

  const good = fakeResponse();
  let passed = false;
  makeOriginGuard({ frontendOrigin: "https://kulkirti.in", isProduction: true })(
    { method: "POST", headers: { origin: "https://kulkirti.in/" } }, good, () => { passed = true; }
  );
  assert.equal(passed, true);

  const render = fakeResponse();
  let renderPassed = false;
  makeOriginGuard({ renderExternalUrl: "https://app.onrender.com", isProduction: true })(
    { method: "POST", headers: { origin: "https://app.onrender.com/" } }, render, () => { renderPassed = true; }
  );
  assert.equal(renderPassed, true);
});

test("rateLimit blocks requests over the configured maximum", () => {
  const { rateLimit } = createRateLimiter();
  const guard = rateLimit({ windowMs: 60_000, max: 2 });
  const request = { ip: "10.0.0.1", path: "/api/vanshawali/trees/token/submit" };
  for (let i = 0; i < 2; i++) {
    const response = fakeResponse();
    let passed = false;
    guard(request, response, () => { passed = true; });
    assert.equal(passed, true);
  }
  const blocked = fakeResponse();
  guard(request, blocked, () => assert.fail("third request should be blocked"));
  assert.equal(blocked.statusCode, 429);
  assert.ok(Number(blocked.headers["retry-after"]) > 0);
});

test("errorStatus preserves explicit 4xx statuses", () => {
  assert.equal(errorStatus({ status: 413 }), 413);
  assert.equal(errorStatus({ statusCode: 400 }), 400);
  assert.equal(errorStatus({ status: 302 }), 500);
  assert.equal(errorStatus(new Error("boom")), 500);
});
