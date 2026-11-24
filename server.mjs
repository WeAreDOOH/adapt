import { createHmac, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";

const port = Number(process.env.PORT || 3103);
const staticRoot = path.resolve(process.env.ADAPT_STATIC_ROOT || "dist");
const sessionSecret = process.env.AUTH_SESSION_SECRET?.trim() || "";
const upstream = process.env.EXPERIMENTS_AUTH_URL || "http://127.0.0.1:8787/api/auth/session";
const cookieName = "adapt_session";
const attempts = new Map();
const publicFiles = new Map([
  ["/login.html", ["login.html", "text/html; charset=utf-8"]],
  ["/auth.js", ["auth.js", "text/javascript; charset=utf-8"]],
  ["/account.js", ["account.js", "text/javascript; charset=utf-8"]],
  ["/msal-browser.min.js", ["msal-browser.min.js", "text/javascript; charset=utf-8"]],
]);

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", "https://adapt.dooh.com");
    const session = verifySession(parseCookies(request.headers.cookie || "")[cookieName]);

    if (url.pathname === "/healthz") return json(response, 200, { ok: true });
    if (url.pathname === "/api/auth/config" && request.method === "GET") return authConfig(response);
    if (url.pathname === "/api/auth/status" && request.method === "GET") {
      return session ? json(response, 200, { user: publicUser(session) }) : json(response, 401, { error: "Microsoft sign-in is required." });
    }
    if (url.pathname === "/api/auth/session" && request.method === "POST") return createSession(request, response);
    if (url.pathname === "/api/auth/logout" && request.method === "POST") {
      response.setHeader("Set-Cookie", `${cookieName}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
      return json(response, 200, { ok: true });
    }

    if (publicFiles.has(url.pathname)) {
      const [file, type] = publicFiles.get(url.pathname);
      return serve(response, request.method, file, type);
    }
    if (url.pathname !== "/" && url.pathname !== "/index.html") return json(response, 404, { error: "Not found" });
    return session
      ? serve(response, request.method, "index.html", "text/html; charset=utf-8")
      : serve(response, request.method, "login.html", "text/html; charset=utf-8");
  } catch (reason) {
    console.error(reason);
    json(response, 500, { error: "Adapt could not complete this request." });
  }
});

server.listen(port, "127.0.0.1", () => console.log(`Adapt listening on 127.0.0.1:${port}`));

function authConfig(response) {
  const tenantId = process.env.ENTRA_TENANT_ID?.trim() || "";
  const clientId = process.env.ENTRA_CLIENT_ID?.trim() || "";
  const apiClientId = process.env.ENTRA_API_CLIENT_ID?.trim() || "";
  if (!tenantId || !clientId || !apiClientId) return json(response, 503, { error: "Microsoft sign-in is not configured." });
  return json(response, 200, { tenantId, clientId, apiScope: `api://${apiClientId}/access_as_user` });
}

async function createSession(request, response) {
  const ip = String(request.headers["x-forwarded-for"] || request.socket.remoteAddress || "").split(",")[0].trim();
  if (!allowAttempt(ip)) return json(response, 429, { error: "Too many sign-in attempts. Please wait a minute." });
  const body = await readBody(request, 64 * 1024);
  const payload = JSON.parse(body || "{}");
  if (typeof payload.accessToken !== "string" || !payload.accessToken) return json(response, 400, { error: "A Microsoft access token is required." });

  const verified = await fetch(upstream, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-Host": "experiments.dooh.com", "X-Forwarded-Proto": "https" },
    body: JSON.stringify({ accessToken: payload.accessToken }),
  });
  const result = await verified.json().catch(() => ({}));
  if (!verified.ok) return json(response, verified.status, result);

  const setCookie = typeof verified.headers.getSetCookie === "function"
    ? verified.headers.getSetCookie().join(";")
    : verified.headers.get("set-cookie") || "";
  const token = setCookie.match(/dooh_experiments_session=([^;]+)/)?.[1];
  const session = verifySession(token);
  if (!session) return json(response, 502, { error: "The verified Microsoft session could not be established." });

  response.setHeader("Set-Cookie", `${cookieName}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=28800`);
  return json(response, 200, { user: publicUser(session) });
}

function verifySession(token) {
  if (!token || sessionSecret.length < 32) return null;
  try {
    const [encodedHeader, encodedPayload, encodedSignature, extra] = token.split(".");
    if (extra || !encodedHeader || !encodedPayload || !encodedSignature) return null;
    const header = JSON.parse(Buffer.from(encodedHeader, "base64url").toString("utf8"));
    if (header.alg !== "HS256") return null;
    const expected = createHmac("sha256", sessionSecret).update(`${encodedHeader}.${encodedPayload}`).digest();
    const actual = Buffer.from(encodedSignature, "base64url");
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
    const audience = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (payload.iss !== "experiments.dooh.com" || !audience.includes("experiments.dooh.com")) return null;
    if (!Number.isFinite(payload.exp) || payload.exp * 1000 <= Date.now()) return null;
    if (typeof payload.email !== "string" || typeof payload.oid !== "string") return null;
    return payload;
  } catch {
    return null;
  }
}

function parseCookies(value) {
  return Object.fromEntries(value.split(";").map((part) => part.trim().split(/=(.*)/s).slice(0, 2)).filter(([key, item]) => key && item !== undefined));
}

function publicUser(session) {
  return { email: session.email, name: typeof session.name === "string" ? session.name : session.email, role: session.role === "owner" ? "owner" : "user" };
}

function allowAttempt(ip) {
  const now = Date.now();
  const recent = (attempts.get(ip) || []).filter((time) => now - time < 60_000);
  recent.push(now);
  attempts.set(ip, recent);
  return recent.length <= 10;
}

async function readBody(request, limit) {
  let total = 0;
  const chunks = [];
  for await (const chunk of request) {
    total += chunk.length;
    if (total > limit) throw new Error("Request body too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function serve(response, method, file, contentType) {
  const data = await readFile(path.join(staticRoot, file));
  response.writeHead(200, {
    "Content-Type": contentType,
    "Content-Length": data.length,
    "Cache-Control": file.endsWith(".html") ? "no-store" : "private, max-age=3600",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Frame-Options": "DENY",
  });
  response.end(method === "HEAD" ? undefined : data);
}

function json(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body), "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  response.end(body);
}
