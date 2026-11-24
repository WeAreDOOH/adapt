import { readFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { openAdaptDatabase } from "./lib/database.mjs";
import { AuthenticationError, bearerToken, createEntraVerifier } from "./lib/entra.mjs";

const port = Number(process.env.PORT || 3103);
const staticRoot = path.resolve(process.env.ADAPT_STATIC_ROOT || "dist");
const tenantId = process.env.ENTRA_TENANT_ID?.trim() || "";
const spaClientId = process.env.ENTRA_SPA_CLIENT_ID?.trim() || "";
const apiClientId = process.env.ENTRA_API_CLIENT_ID?.trim() || "";
const databasePath = path.resolve(process.env.ADAPT_DB_PATH || "data/adapt.sqlite");
const verifier = createEntraVerifier({ tenantId, spaClientId, apiClientId });
const database = openAdaptDatabase(databasePath, {
  bootstrapEmail: process.env.ADAPT_BOOTSTRAP_EMAIL || "",
  bootstrapName: process.env.ADAPT_BOOTSTRAP_NAME || "Adapt Owner",
});

const publicFiles = new Map([
  ["/auth.js", ["auth.js", "text/javascript; charset=utf-8"]],
  ["/msal-client.js", ["msal-client.js", "text/javascript; charset=utf-8"]],
  ["/account.js", ["account.js", "text/javascript; charset=utf-8"]],
  ["/users.js", ["users.js", "text/javascript; charset=utf-8"]],
  ["/msal-browser.min.js", ["msal-browser.min.js", "text/javascript; charset=utf-8"]],
]);

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", "https://adapt.dooh.com");

    if (url.pathname === "/healthz") return json(response, 200, { ok: true });
    if (url.pathname === "/api/auth/config" && request.method === "GET") {
      return json(response, 200, {
        tenantId,
        clientId: spaClientId,
        apiScope: `api://${apiClientId}/access_as_user`,
      });
    }
    if (url.pathname === "/api/me" && request.method === "GET") {
      const user = await requireActiveUser(request);
      return json(response, 200, { user });
    }
    if (url.pathname === "/api/planner" && request.method === "GET") {
      await requireActiveUser(request);
      return serve(response, request.method, "index.html", "text/html; charset=utf-8");
    }
    if (url.pathname === "/api/admin/users" && request.method === "GET") {
      const user = await requireActiveUser(request);
      requirePermission(user, "adapt.manage_users");
      return json(response, 200, { users: database.listUsers() });
    }
    if (url.pathname === "/api/admin/users" && request.method === "POST") {
      const user = await requireActiveUser(request);
      requirePermission(user, "adapt.manage_users");
      try {
        const body = await readJson(request);
        return json(response, 200, { users: database.addUser(body.email, user.email) });
      } catch (reason) {
        return json(response, 400, { error: errorMessage(reason) });
      }
    }
    if (url.pathname === "/api/admin/users" && request.method === "DELETE") {
      const user = await requireActiveUser(request);
      requirePermission(user, "adapt.manage_users");
      try {
        const body = await readJson(request);
        return json(response, 200, { users: database.removeUser(body.email, user.email) });
      } catch (reason) {
        return json(response, 400, { error: errorMessage(reason) });
      }
    }

    if (publicFiles.has(url.pathname)) {
      const [file, type] = publicFiles.get(url.pathname);
      return serve(response, request.method, file, type);
    }
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return serve(response, request.method, "login.html", "text/html; charset=utf-8");
    }
    if (url.pathname === "/admin/users") {
      return serve(response, request.method, "users.html", "text/html; charset=utf-8");
    }
    return json(response, 404, { error: "Not found" });
  } catch (reason) {
    if (reason instanceof AuthenticationError) {
      response.setHeader("WWW-Authenticate", `Bearer error="${reason.code}"`);
      return json(response, 401, { code: reason.code, error: reason.message });
    }
    if (reason instanceof ApplicationAccessError) {
      return json(response, 403, { code: "application_access_denied", error: reason.message });
    }
    console.error(reason);
    return json(response, 500, { error: "Adapt could not complete this request." });
  }
});

server.listen(port, "127.0.0.1", () => console.log(`Adapt listening on 127.0.0.1:${port}`));

async function requireActiveUser(request) {
  const identity = await verifier.verify(bearerToken(request));
  const user = database.authorize(identity);
  if (!user) {
    throw new ApplicationAccessError(
      "Microsoft sign-in succeeded, but this account is not an active Adapt user.",
    );
  }
  return user;
}

class ApplicationAccessError extends Error {
  constructor(message) {
    super(message);
    this.name = "ApplicationAccessError";
  }
}

function requirePermission(user, permission) {
  const allowed = user.organisationPermissions.some((entry) => entry.permission === permission);
  if (!allowed) throw new ApplicationAccessError("Owner access is required.");
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 16_384) throw new Error("The request is too large.");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw new Error("The request body is not valid JSON.");
  }
}

function errorMessage(reason) {
  return reason instanceof Error ? reason.message : "The user list could not be updated.";
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
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(body);
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    database.close();
    server.close(() => process.exit(0));
  });
}
