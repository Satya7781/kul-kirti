/**
 * http-security.js — small, dependency-free HTTP guards shared by server.js.
 *
 * Kept module-level (instead of closing over server.js state) so the auth,
 * RBAC, rate-limit and origin checks can be unit-tested without a database.
 */
"use strict";

const jwt = require("jsonwebtoken");

/** Create an isolated rate limiter (isolated state makes it testable). */
function createRateLimiter() {
  const windows = new Map();
  let lastSweep = Date.now();

  function prune(now) {
    if (now - lastSweep < 60_000) return;
    lastSweep = now;
    for (const [bucketKey, bucket] of windows) {
      if (now - bucket.startedAt >= bucket.windowMs) windows.delete(bucketKey);
    }
  }

  function rateLimit({ windowMs, max, key = (request) => request.ip, message = "Too many requests. Please try again later." }) {
    return (request, response, next) => {
      const now = Date.now();
      prune(now);
      const bucketKey = `${String(key(request))}:${request.path || ""}`;
      const bucket = windows.get(bucketKey);
      if (!bucket || now - bucket.startedAt >= windowMs) {
        windows.set(bucketKey, { startedAt: now, count: 1, windowMs });
        return next();
      }
      bucket.count += 1;
      if (bucket.count > max) {
        response.set("Retry-After", String(Math.ceil((windowMs - (now - bucket.startedAt)) / 1000)));
        return response.status(429).json({ error: message });
      }
      return next();
    };
  }

  return { rateLimit, reset: () => windows.clear(), size: () => windows.size };
}

/**
 * CSRF origin guard.
 *  - In production FRONTEND_ORIGIN is mandatory for authenticated endpoints.
 *  - `requireOrigin` rejects mutation requests without an Origin header.
 *  - No trust is derived from Host / x-forwarded-proto when FRONTEND_ORIGIN is set.
 */
function makeOriginGuard({
  frontendOrigin = process.env.FRONTEND_ORIGIN,
  requireOrigin = false,
  isProduction = process.env.NODE_ENV === "production",
} = {}) {
  const configured = frontendOrigin ? frontendOrigin.replace(/\/$/, "").toLowerCase() : null;
  return function originGuard(request, response, next) {
    if (isProduction && !configured) {
      return response.status(503).json({ error: "FRONTEND_ORIGIN must be configured." });
    }
    if (request.method === "GET" || request.method === "HEAD" || request.method === "OPTIONS") return next();
    const origin = request.headers && request.headers.origin;
    if (!origin) {
      if (requireOrigin) return response.status(403).json({ error: "Cross-site request blocked." });
      return next();
    }
    if (String(origin).replace(/\/$/, "").toLowerCase() !== configured) {
      return response.status(403).json({ error: "Cross-site request blocked." });
    }
    next();
  };
}

/** No-store for authenticated / token-bearing responses. */
function noStore(_request, response, next) {
  response.set("Cache-Control", "no-store, private, max-age=0");
  response.set("Pragma", "no-cache");
  next();
}

/**
 * Authenticate an admin JWT.  The current admin row is loaded on every request
 * so a changed/removed role or deleted account takes effect immediately.
 */
function makeAuth({ jwtSecret, verify = jwt.verify, isRevoked = async () => false, loadAdmin, unauthorized }) {
  const reject = unauthorized || ((response) => response.status(401).json({ error: "Admin authentication required." }));
  return async function auth(request, response, next) {
    const token = request.cookies?.kulkirti_admin || request.headers?.authorization?.replace("Bearer ", "");
    if (!token) return reject(response);
    let claims;
    try {
      claims = verify(token, jwtSecret);
    } catch {
      return reject(response);
    }
    if (!claims || (!claims.id && !claims.sub)) return reject(response);
    if (claims.jti && await isRevoked(claims.jti)) return reject(response);
    let admin;
    try {
      admin = await loadAdmin(claims.id || claims.sub);
    } catch {
      return response.status(503).json({ error: "Authentication is temporarily unavailable." });
    }
    if (!admin) return reject(response);
    request.admin = { id: admin.id, email: admin.email, role: admin.role, jti: claims.jti };
    next();
  };
}

/**
 * Role gate with NO privilege fallback.  An admin whose token predates the
 * role claim still passes because makeAuth() loads the role from the DB.
 */
function roleGuard(...roles) {
  return (request, response, next) => {
    if (!request.admin) return response.status(401).json({ error: "Admin authentication required." });
    if (!request.admin.role || !roles.includes(request.admin.role)) {
      return response.status(403).json({ error: "You are not permitted to perform this action." });
    }
    next();
  };
}

/** Preserve client-error status codes instead of collapsing everything to 500. */
function errorStatus(error, fallback = 500) {
  const status = Number(error?.status || error?.statusCode);
  return status >= 400 && status < 500 ? status : fallback;
}

module.exports = {
  createRateLimiter,
  makeOriginGuard,
  noStore,
  makeAuth,
  roleGuard,
  errorStatus,
};
