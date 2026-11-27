import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import http from "node:http";
import path from "node:path";
import { openAdaptDatabase } from "./lib/database.mjs";
import { AuthenticationError, bearerToken, createEntraVerifier } from "./lib/entra.mjs";
import { ApprovalError, openApprovals } from "./lib/approvals.mjs";
import { pipeline } from "node:stream/promises";

const port = Number(process.env.PORT || 3103);
const staticRoot = path.resolve(process.env.ADAPT_STATIC_ROOT || "dist");
const authDisabled = process.env.ADAPT_AUTH_DISABLED === "1";
const tenantId = process.env.ENTRA_TENANT_ID?.trim() || "";
const spaClientId = process.env.ENTRA_SPA_CLIENT_ID?.trim() || "";
const apiClientId = process.env.ENTRA_API_CLIENT_ID?.trim() || "";
const databasePath = path.resolve(process.env.ADAPT_DB_PATH || "data/adapt.sqlite");
const openAiKey = process.env.OPENAI_API_KEY?.trim() || "";
const openAiModel = process.env.ADAPT_OPENAI_MODEL?.trim() || "gpt-5.4-mini";
const reviewLimits = new Map();
const verifier = authDisabled ? null : createEntraVerifier({ tenantId, spaClientId, apiClientId });
const database = openAdaptDatabase(databasePath, {
  bootstrapEmail: process.env.ADAPT_BOOTSTRAP_EMAIL || "",
  bootstrapName: process.env.ADAPT_BOOTSTRAP_NAME || "Adapt Owner",
});
const approvals = openApprovals(path.join(path.dirname(databasePath), "approval-workspace"));

const publicFiles = new Map([
  ["/auth.js", ["auth.js", "text/javascript; charset=utf-8"]],
  ["/msal-client.js", ["msal-client.js", "text/javascript; charset=utf-8"]],
  ["/account.js", ["account.js", "text/javascript; charset=utf-8"]],
  ["/users.js", ["users.js", "text/javascript; charset=utf-8"]],
  ["/msal-browser.min.js", ["msal-browser.min.js", "text/javascript; charset=utf-8"]],
  ["/approvals", ["approvals.html", "text/html; charset=utf-8"]],
  ["/client-review", ["approvals.html", "text/html; charset=utf-8"]],
  ["/approvals.js", ["approvals.js", "text/javascript; charset=utf-8"]],
  ["/approvals.css", ["approvals.css", "text/css; charset=utf-8"]],
]);

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", "https://adapt.dooh.com");

    if (url.pathname === "/healthz") return json(response, 200, { ok: true });
    if (url.pathname.startsWith("/api/approvals/")) {
      return await handleApprovals(request, response, url.pathname);
    }
    if (url.pathname === "/api/auth/config" && request.method === "GET") {
      return json(response, 200, {
        authDisabled,
        tenantId,
        clientId: spaClientId,
        apiScope: `api://${apiClientId}/access_as_user`,
      });
    }
    if (url.pathname === "/api/me" && request.method === "GET") {
      if (authDisabled) return json(response, 200, { authDisabled: true, user: null });
      const user = await requireActiveUser(request);
      return json(response, 200, { user });
    }
    if (url.pathname === "/api/review/config" && request.method === "GET") {
      return json(response, 200, { enabled: Boolean(openAiKey), maxBytes: 10_000_000 });
    }
    if (url.pathname === "/api/review-dimensions" && request.method === "POST") {
      if (!openAiKey) return json(response, 503, { error: "AI document review is not configured yet." });
      if (!authDisabled) await requireActiveUser(request);
      enforceReviewRateLimit(request);
      try {
        const filename = safeFilename(request.headers["x-file-name"]);
        const mimeType = safeMimeType(request.headers["x-file-type"], filename);
        const bytes = await readBody(request, 10_000_000);
        if (!bytes.length) throw new Error("Choose a document to review.");
        return json(response, 200, await reviewDimensions({ filename, mimeType, bytes }));
      } catch (reason) {
        return json(response, 400, { error: errorMessage(reason) });
      }
    }
    if (url.pathname === "/api/plans" && request.method === "POST") {
      try {
        const body = await readJson(request, 300_000);
        return json(response, 201, database.createPlan(body.name, body.plan));
      } catch (reason) {
        return json(response, 400, { error: errorMessage(reason) });
      }
    }
    const savedPlanMatch = url.pathname.match(/^\/api\/plans\/([A-Za-z0-9_-]{16})$/);
    if (savedPlanMatch && request.method === "GET") {
      try {
        const plan = database.getPlan(savedPlanMatch[1]);
        return plan ? json(response, 200, plan) : json(response, 404, { error: "That saved plan was not found." });
      } catch (reason) {
        return json(response, 400, { error: errorMessage(reason) });
      }
    }
    if (savedPlanMatch && request.method === "PUT") {
      try {
        const body = await readJson(request, 300_000);
        const plan = database.updatePlan(savedPlanMatch[1], request.headers["x-adapt-plan-key"], body.name, body.plan);
        return json(response, 200, plan);
      } catch (reason) {
        return json(response, 403, { error: errorMessage(reason) });
      }
    }
    if (url.pathname === "/api/planner" && request.method === "GET") {
      if (!authDisabled) await requireActiveUser(request);
      return serve(response, request.method, "index.html", "text/html; charset=utf-8");
    }
    if (authDisabled && (url.pathname === "/admin/users" || url.pathname.startsWith("/api/admin/"))) {
      return json(response, 503, { error: "User administration is unavailable while sign-in is disabled." });
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
      return serve(
        response,
        request.method,
        authDisabled ? "index.html" : "login.html",
        "text/html; charset=utf-8",
      );
    }
    if (url.pathname === "/admin/users") {
      return serve(response, request.method, "users.html", "text/html; charset=utf-8");
    }
    return json(response, 404, { error: "Not found" });
  } catch (reason) {
    if (response.headersSent) return response.destroy();
    if (reason instanceof ApprovalError) return json(response, reason.status, { error: reason.message });
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

async function handleApprovals(request, response, pathname) {
  const method = request.method;
  const ownerRoute = pathname.match(/^\/api\/approvals\/plans\/([A-Za-z0-9_-]{16})(\/.*)?$/);
  const token = request.headers["x-adapt-review-key"];
  if (ownerRoute) {
    const [, plan, action = ""] = ownerRoute;
    const saved = database.getOwnedPlan(plan, request.headers["x-adapt-plan-key"]);
    if (!saved) throw new ApprovalError(403, "Open this workspace from the browser that owns the saved plan.");
    if (!action && method === "GET") return json(response, 200, { title: saved.name, ...approvals.workspace(plan) });
    if (action === "/formats" && method === "PUT") {
      const { formats } = (await readJson(request)) ?? {};
      return json(response, 200, { title: saved.name, ...approvals.setFormats(plan, formats) });
    }
    if (action === "/rounds" && method === "POST") {
      return json(response, 201, approvals.submit(plan, saved.name, await readJson(request, 30_000)));
    }
    const revoke = action.match(/^\/rounds\/([A-Za-z0-9_-]{16})$/);
    if (revoke && method === "DELETE") {
      approvals.revoke(plan, revoke[1]);
      return json(response, 200, { ok: true });
    }
    const upload = action.match(/^\/artwork\/([0-9]{1,5}x[0-9]{1,5})$/);
    if (upload && method === "POST") {
      let filename;
      try { filename = decodeURIComponent(String(request.headers["x-file-name"] || "")); } catch {}
      filename = path.basename(filename || "Artwork").replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 180);
      const version = await approvals.upload(plan, upload[1], filename, request);
      return json(response, 201, version);
    }
    const version = action.match(/^\/versions\/([A-Za-z0-9_-]{16})(\/image)?$/);
    if (version && method === "GET") {
      return version[2]
        ? await sendArtwork(response, approvals.artwork(version[1], { plan }))
        : json(response, 200, approvals.history(plan, version[1]));
    }
  }
  if (pathname === "/api/approvals/review" && method === "GET") {
    return json(response, 200, approvals.review(token));
  }
  const entry = pathname.match(/^\/api\/approvals\/review\/([A-Za-z0-9_-]{16})(\/image|\/decision|\/feedback)$/);
  if (entry && entry[2] === "/image" && method === "GET") {
    return await sendArtwork(response, approvals.artwork(entry[1], { token }));
  }
  if (entry && entry[2] === "/decision" && method === "POST") {
    approvals.decide(token, entry[1], await readJson(request, 300_000));
    return json(response, 200, approvals.review(token));
  }
  if (entry && entry[2] === "/feedback" && method === "GET") {
    return json(response, 200, approvals.feedback(token, entry[1]));
  }
  return json(response, 404, { error: "Not found" });
}

async function sendArtwork(response, image) {
  response.writeHead(200, {
    "Content-Type": image.mime, "Content-Length": image.bytes,
    "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
  });
  await pipeline(image.stream, response);
}

server.listen(port, "127.0.0.1", () => console.log(`Adapt listening on 127.0.0.1:${port}`));

async function requireActiveUser(request) {
  if (!verifier) throw new AuthenticationError("Microsoft sign-in is temporarily disabled.", "auth_disabled");
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

async function readJson(request, limit = 16_384) {
  const bytes = await readBody(request, limit);
  try {
    return JSON.parse(bytes.toString("utf8") || "{}");
  } catch {
    throw new ApprovalError(400, "The request body is not valid JSON.");
  }
}

async function readBody(request, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new ApprovalError(413, "The file or request is too large.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function errorMessage(reason) {
  return reason instanceof Error ? reason.message : "Adapt could not complete this request.";
}

function safeFilename(value) {
  let filename = typeof value === "string" ? value : "";
  try { filename = decodeURIComponent(filename); } catch {}
  filename = path.basename(filename).replace(/[^A-Za-z0-9._() -]/g, "_").slice(0, 180);
  if (!filename || !/\.(pdf|csv|tsv|xls|xlsx|doc|docx|rtf|odt|txt|md|ppt|pptx)$/i.test(filename)) {
    throw new Error("Use a PDF, spreadsheet, Word document, PowerPoint or text file.");
  }
  return filename;
}

function safeMimeType(value, filename) {
  const supplied = typeof value === "string" ? value.split(";")[0].trim() : "";
  if (/^[\w.+-]+\/[\w.+-]+$/.test(supplied) && supplied !== "application/octet-stream") return supplied;
  const ext = path.extname(filename).toLowerCase();
  return ({
    ".pdf": "application/pdf", ".csv": "text/csv", ".tsv": "text/tsv", ".txt": "text/plain", ".md": "text/markdown",
    ".xls": "application/vnd.ms-excel", ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".doc": "application/msword", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".ppt": "application/vnd.ms-powerpoint", ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".rtf": "application/rtf", ".odt": "application/vnd.oasis.opendocument.text",
  })[ext] || "text/plain";
}

function enforceReviewRateLimit(request) {
  const forwarded = String(request.headers["x-forwarded-for"] || "").split(",")[0].trim();
  const address = forwarded || request.socket.remoteAddress || "unknown";
  const key = createHash("sha256").update(address).digest("hex").slice(0, 16);
  const now = Date.now();
  const recent = (reviewLimits.get(key) || []).filter((time) => now - time < 60 * 60 * 1000);
  if (recent.length >= 10 || recent.filter((time) => now - time < 5 * 60 * 1000).length >= 4) {
    throw new Error("Too many document reviews from this connection. Try again later.");
  }
  recent.push(now);
  reviewLimits.set(key, recent);
}

async function reviewDimensions({ filename, mimeType, bytes }) {
  const fileData = `data:${mimeType};base64,${bytes.toString("base64")}`;
  const apiResponse = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${openAiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: openAiModel,
      store: false,
      input: [{ role: "user", content: [
        { type: "input_file", filename, file_data: fileData, ...(mimeType === "application/pdf" ? { detail: "high" } : {}) },
        { type: "input_text", text: DIMENSION_REVIEW_PROMPT },
      ] }],
      text: { format: { type: "json_schema", name: "screen_dimension_review", strict: true, schema: DIMENSION_REVIEW_SCHEMA } },
    }),
    signal: AbortSignal.timeout(120_000),
  });
  const data = await apiResponse.json().catch(() => ({}));
  if (!apiResponse.ok) {
    const message = data?.error?.message || "The AI review could not be completed.";
    throw new Error(message.replace(/\bsk-[A-Za-z0-9_-]+\b/g, "[redacted]"));
  }
  const output = (data.output || []).flatMap((item) => item.content || []).find((part) => part.type === "output_text")?.text;
  if (!output) throw new Error("The AI review returned no readable result.");
  const review = JSON.parse(output);
  return { filename, model: openAiModel, reviewedAt: new Date().toISOString(), review };
}

const DIMENSION_REVIEW_PROMPT = `You are a meticulous out-of-home advertising artwork planner. Inspect the entire uploaded file for screen, canvas, artwork, placement and print dimensions. Return a verbose audit, not a terse extraction.

Rules:
- Never silently assume a number pair is a screen size. Explain the surrounding evidence.
- Detect width and height in separate columns, separate rows, tables, merged headings, worksheets, pages and prose.
- Detect compact forms such as 1020x768, 1020 × 768, 1020*768 and values without units.
- For unitless digital-looking integer pairs, state whether you inferred pixels and whether the document establishes the industry-standard width × height order. If it does not, flag the order as an assumption.
- Flag headers or evidence that use height before width, mixed order, swapped orientations, inconsistent units, duplicates, near-duplicates, malformed values, missing values and dimensions that look implausible.
- Treat physical print dimensions as physical. Do not pretend they are pixels. Give 300 and 500 DPI pixel equivalents when the unit permits conversion, but keep status physical_review.
- Distinguish genuine dimensions from ratios, dates, quantities, file sizes, prices and unrelated number pairs.
- One result row per distinct source occurrence. Preserve source location using worksheet/page/table/row/cell language as precisely as possible.
- Ready means safe to import as pixel width × height. Review means a human should confirm order, unit or context. Physical_review always needs a production decision.
- Recommendations must tell the artwork producer what to confirm before import.`;

const DIMENSION_REVIEW_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["summary", "documentConvention", "dimensions", "anomalies", "recommendations"],
  properties: {
    summary: { type: "string" },
    documentConvention: {
      type: "object", additionalProperties: false, required: ["order", "units", "evidence"],
      properties: {
        order: { type: "string", enum: ["width_height", "height_width", "mixed", "unknown"] },
        units: { type: "string" }, evidence: { type: "string" },
      },
    },
    dimensions: {
      type: "array", items: {
        type: "object", additionalProperties: false,
        required: ["width", "height", "unit", "raw", "source", "interpretation", "confidence", "status", "pixelEquivalent300", "pixelEquivalent500"],
        properties: {
          width: { type: ["number", "null"] }, height: { type: ["number", "null"] },
          unit: { type: "string", enum: ["px", "mm", "cm", "m", "in", "ft", "unknown"] },
          raw: { type: "string" }, source: { type: "string" }, interpretation: { type: "string" },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
          status: { type: "string", enum: ["ready", "review", "physical_review"] },
          pixelEquivalent300: { type: ["string", "null"] }, pixelEquivalent500: { type: ["string", "null"] },
        },
      },
    },
    anomalies: {
      type: "array", items: {
        type: "object", additionalProperties: false, required: ["severity", "title", "detail", "sources"],
        properties: {
          severity: { type: "string", enum: ["info", "warning", "critical"] },
          title: { type: "string" }, detail: { type: "string" }, sources: { type: "array", items: { type: "string" } },
        },
      },
    },
    recommendations: { type: "array", items: { type: "string" } },
  },
};

async function serve(response, method, file, contentType) {
  const data = await readFile(path.join(staticRoot, file));
  const mutableAsset = ["auth.js", "msal-client.js", "account.js", "users.js", "approvals.js", "approvals.css"].includes(file);
  const approvalPage = file === "approvals.html";
  response.writeHead(200, {
    "Content-Type": contentType,
    "Content-Length": data.length,
    "Cache-Control": file.endsWith(".html") || mutableAsset
      ? "no-store"
      : "private, max-age=3600, immutable",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": approvalPage ? "no-referrer" : "strict-origin-when-cross-origin",
    "X-Frame-Options": "DENY",
    ...(approvalPage && {
      "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
      "X-Robots-Tag": "noindex, nofollow",
    }),
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
    server.close(() => {
      approvals.close();
      database.close();
      process.exit(0);
    });
  });
}
