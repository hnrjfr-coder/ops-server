const DEFAULT_CLIENT_ORIGIN = "http://localhost:3000";

export function getAllowedOrigins(configuredOrigins = DEFAULT_CLIENT_ORIGIN) {
  const entries = String(configuredOrigins)
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  const allowedOrigins = new Set();

  for (const entry of entries) {
    let parsed;
    try {
      parsed = new URL(entry);
    } catch {
      throw new Error(`CLIENT_ORIGIN contains an invalid origin: ${entry}`);
    }

    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    ) {
      throw new Error(`CLIENT_ORIGIN must contain origins only, without paths or credentials: ${entry}`);
    }

    allowedOrigins.add(parsed.origin);
  }

  if (allowedOrigins.size === 0) {
    throw new Error("CLIENT_ORIGIN must contain at least one allowed origin.");
  }

  return allowedOrigins;
}

export function createCorsMiddleware(allowedOrigins) {
  return (request, response, next) => {
    response.vary("Origin");
    const origin = request.headers.origin;
    const originAllowed = Boolean(origin && allowedOrigins.has(origin));

    if (originAllowed) {
      response.header("Access-Control-Allow-Origin", origin);
      response.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
      response.header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    }

    if (request.method === "OPTIONS") {
      if (origin && !originAllowed) return response.sendStatus(403);
      return response.sendStatus(204);
    }

    return next();
  };
}
