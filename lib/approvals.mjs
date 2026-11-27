import { createHash, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream, mkdirSync } from "node:fs";
import { open, unlink } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

export const MAX_ART_BYTES = 20_000_000;
const WORKSPACE_QUOTA = 250_000_000;
const TOTAL_QUOTA = 2_000_000_000;
const id = () => randomBytes(12).toString("base64url");
const digest = (value) => createHash("sha256").update(value).digest("hex");
const now = () => new Date().toISOString();
const validKey = (value) => typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);

export class ApprovalError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
function ensure(test, message, status = 400) {
  if (!test) throw new ApprovalError(status, message);
}

export function openApprovals(directory) {
  const files = path.join(directory, "artwork");
  mkdirSync(files, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path.join(directory, "approvals.sqlite"));
  db.exec(SCHEMA);
  const get = (sql, ...args) => db.prepare(sql).get(...args);
  const all = (sql, ...args) => db.prepare(sql).all(...args);
  const run = (sql, ...args) => db.prepare(sql).run(...args);
  let uploads = 0;

  function transaction(work) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  function workspace(plan) {
    const formats = all("SELECT size, width, height FROM formats WHERE plan = ? AND active = 1 ORDER BY position", plan);
    const versions = all("SELECT id, size, number, filename, created, status FROM versions WHERE plan = ? ORDER BY number DESC", plan);
    const bySize = Map.groupBy(versions, (version) => version.size);
    const rounds = all(`SELECT r.id, r.number, r.recipient, r.message, r.created, r.expires, r.revoked, r.completed,
      COUNT(i.version) AS total, COUNT(i.decision) AS decided
      FROM rounds r JOIN items i ON r.id = i.round WHERE r.plan = ? GROUP BY r.id ORDER BY r.number DESC`, plan);
    return {
      formats: formats.map((format) => ({ ...format, versions: bySize.get(format.size) ?? [] })),
      archived: [...bySize].filter(([size]) => !formats.some((format) => format.size === size))
        .map(([size, history]) => ({ size, versions: history })),
      rounds,
    };
  }

  function setFormats(plan, formats) {
    ensure(Array.isArray(formats) && formats.length <= 500, "Use no more than 500 unique pixel sizes.");
    const sizes = new Set();
    for (const f of formats) {
      ensure(Number.isInteger(f?.width) && Number.isInteger(f?.height) &&
        f.width > 0 && f.height > 0 && f.width <= 30000 && f.height <= 30000, "Approvals need whole-pixel dimensions up to 30,000 px per edge.");
      sizes.add(`${f.width}x${f.height}`);
    }
    transaction(() => {
      run("UPDATE formats SET active = 0 WHERE plan = ?", plan);
      [...sizes].forEach((size, position) => {
        const [w, h] = size.split("x").map(Number);
        run(`INSERT INTO formats (plan, size, width, height, position) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(plan, size) DO UPDATE SET active = 1, position = excluded.position`, plan, size, w, h, position);
      });
    });
    return workspace(plan);
  }

  async function upload(plan, size, name, request) {
    const format = get("SELECT * FROM formats WHERE plan = ? AND size = ? AND active = 1", plan, size);
    ensure(format, "This size is not in the approval workspace.", 404);
    const prior = latest(plan, size);
    ensure(!prior || prior.status !== "in_review", "This size is still with the reviewer. Revoke its round before replacing it.", 409);
    ensure(!prior || request.headers["x-adapt-initial-artwork"] !== "1", "This size already has artwork.", 409);
    ensure(uploads < 2, "Adapt is processing other uploads. Try again shortly.", 429);
    const length = Number(request.headers["content-length"]);
    ensure(!Number.isFinite(length) || length <= MAX_ART_BYTES, "Artwork must be under 20 MB.", 413);
    const key = id();
    const target = path.join(files, key);
    const hash = createHash("sha256");
    let bytes = 0;
    uploads++;
    try {
      const limit = new Transform({
        transform(chunk, encoding, callback) {
          bytes += chunk.length;
          if (bytes > MAX_ART_BYTES) return callback(new ApprovalError(413, "Artwork must be under 20 MB."));
          hash.update(chunk);
          callback(null, chunk);
        },
      });
      // Keep the response socket usable if the upload stream fails.
      const writing = pipeline(limit, createWriteStream(target, { flags: "wx", mode: 0o600 }));
      request.on("error", (error) => limit.destroy(error));
      request.on("close", () => { if (!request.complete) limit.destroy(new ApprovalError(400, "The upload was interrupted.")); });
      request.pipe(limit);
      await writing;
      const fd = await open(target, "r");
      const head = Buffer.alloc(Math.min(bytes, 512_000));
      try { await fd.read(head, 0, head.length, 0); } finally { await fd.close(); }
      const image = imageInfo(head);
      ensure(image, "Use a PNG, JPEG or WebP artwork file.");
      ensure(image.width === format.width && image.height === format.height,
        `Expected ${format.width} × ${format.height} px. The file is ${image.width} × ${image.height} px.`);
      const checksum = hash.digest("hex");
      return transaction(() => {
        const previous = latest(plan, size);
        ensure(get("SELECT 1 FROM formats WHERE plan = ? AND size = ? AND active = 1", plan, size) && previous?.id === prior?.id,
          "This size changed during the upload. Refresh and try again.", 409);
        ensure(!previous || previous.status !== "in_review", "This size is still with the reviewer. Revoke its round before replacing it.", 409);
        ensure(!previous || previous.sha256 !== checksum, "This file matches the latest artwork version.", 409);
        ensure(get("SELECT COALESCE(SUM(bytes),0) AS total FROM versions WHERE plan = ?", plan).total + bytes <= WORKSPACE_QUOTA,
          "This workspace has reached its artwork storage limit.", 413);
        ensure(get("SELECT COALESCE(SUM(bytes),0) AS total FROM versions").total + bytes <= TOTAL_QUOTA,
          "Adapt has reached its artwork storage limit.", 503);
        const number = (previous?.number ?? 0) + 1;
        run(`INSERT INTO versions (id, plan, size, number, filename, mime, bytes, sha256, created)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, key, plan, size, number, name, image.mime, bytes, checksum, now());
        return { id: key, number };
      });
    } catch (error) {
      request.unpipe();
      request.resume();
      await unlink(target).catch(() => {});
      throw error;
    } finally {
      uploads--;
    }
  }

  function latest(plan, size) {
    return get("SELECT * FROM versions WHERE plan = ? AND size = ? ORDER BY number DESC LIMIT 1", plan, size);
  }

  function submit(plan, title, body) {
    const { recipient, message, versions, checks } = body ?? {};
    ensure(typeof recipient === "string" && recipient.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient), "Enter a reviewer email.");
    ensure(typeof message === "string" && message.length <= 2000, "Keep the review message under 2,000 characters.");
    ensure(Array.isArray(versions) && versions.length && versions.length <= 500 && new Set(versions).size === versions.length &&
      versions.every((value) => typeof value === "string" && /^[A-Za-z0-9_-]{16}$/.test(value)), "Select artwork for this round.");
    ensure(checks?.spec === true && checks?.layout === true && checks?.scope === true, "Complete all flight checks before submitting.");
    const token = randomBytes(32).toString("base64url");
    return transaction(() => {
      const ready = all(`SELECT v.id FROM formats f JOIN versions v ON v.plan = f.plan AND v.size = f.size
        WHERE f.plan = ? AND f.active = 1 AND v.status = 'draft'
        AND v.number = (SELECT MAX(x.number) FROM versions x WHERE x.plan = f.plan AND x.size = f.size)`, plan);
      const allowed = new Set(ready.map((v) => v.id));
      ensure(versions.every((key) => allowed.has(key)), "The queue changed. Refresh and run the flight check again.", 409);
      const round = id();
      const number = get("SELECT COALESCE(MAX(number),0)+1 AS number FROM rounds WHERE plan = ?", plan).number;
      const expires = new Date(Date.now() + 30 * 86400_000).toISOString();
      run(`INSERT INTO rounds (id, plan, number, token_hash, title, recipient, message, created, expires)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, round, plan, number, digest(token), title, recipient, message, now(), expires);
      versions.forEach((key, position) => {
        run("INSERT INTO items (round, version, position) VALUES (?, ?, ?)", round, key, position);
        run("UPDATE versions SET status = 'in_review' WHERE id = ?", key);
      });
      return { id: round, token, number, expires };
    });
  }

  function reviewByToken(token) {
    const round = validKey(token) && get("SELECT * FROM rounds WHERE token_hash = ? AND revoked IS NULL AND expires > ?", digest(token), now());
    ensure(round, "This review link is invalid, expired or has been revoked.", 404);
    return round;
  }

  function roundItems(round) {
    return all(`SELECT v.id, v.size, v.number, v.filename, i.decision, i.decided
      FROM items i JOIN versions v ON v.id = i.version WHERE i.round = ? ORDER BY i.position`, round);
  }

  function roundItem(round, version) {
    const item = get("SELECT * FROM items WHERE round = ? AND version = ?", round, version);
    ensure(item, "This size is outside your review queue.", 404);
    return item;
  }

  function review(token) {
    const round = reviewByToken(token);
    return {
      id: round.id, number: round.number, title: round.title, message: round.message,
      expires: round.expires, completed: round.completed, items: roundItems(round.id),
    };
  }

  function decide(token, version, body) {
    const round = reviewByToken(token);
    ensure(body?.decision === "approved" || body?.decision === "changes", "Choose an approval decision.");
    const feedback = cleanFeedback(body.feedback);
    ensure(body.decision !== "changes" || feedback.comment || feedback.notes.length || feedback.strokes.some((stroke) => stroke.note),
      "Add a note describing the amendment.");
    transaction(() => {
      const item = roundItem(round.id, version);
      ensure(!item.decision, "This artwork has already been reviewed.", 409);
      run("UPDATE items SET decision = ?, feedback = ?, decided = ? WHERE round = ? AND version = ?",
        body.decision, JSON.stringify(feedback), now(), round.id, version);
      run("UPDATE versions SET status = ? WHERE id = ?", body.decision, version);
      if (!get("SELECT 1 FROM items WHERE round = ? AND decision IS NULL", round.id)) {
        run("UPDATE rounds SET completed = ? WHERE id = ?", now(), round.id);
      }
    });
  }

  function revoke(plan, round) {
    transaction(() => {
      const result = run("UPDATE rounds SET revoked = ? WHERE id = ? AND plan = ? AND revoked IS NULL", now(), round, plan);
      ensure(result.changes, "This review link could not be revoked.", 404);
      run(`UPDATE versions SET status = 'draft' WHERE status = 'in_review'
        AND id IN (SELECT version FROM items WHERE round = ? AND decision IS NULL)`, round);
    });
  }

  function restoreExpired(plan) {
    run(`UPDATE versions SET status = 'draft' WHERE plan = ? AND status = 'in_review'
      AND NOT EXISTS (SELECT 1 FROM items i JOIN rounds r ON r.id = i.round
        WHERE i.version = versions.id AND i.decision IS NULL AND r.revoked IS NULL AND r.expires > ?)`, plan, now());
  }

  function ownedVersion(plan, version) {
    const result = get("SELECT * FROM versions WHERE id = ? AND plan = ?", version, plan);
    ensure(result, "Artwork version not found.", 404);
    return result;
  }

  return {
    workspace(plan) { restoreExpired(plan); return workspace(plan); },
    setFormats, upload, submit, review, decide, revoke,
    feedback(token, version) {
      const item = roundItem(reviewByToken(token).id, version);
      return { feedback: item.feedback ? JSON.parse(item.feedback) : null };
    },
    history(plan, version) {
      const artwork = ownedVersion(plan, version);
      const entries = all(`SELECT r.number AS round, r.created, i.decision, i.feedback, i.decided
        FROM items i JOIN rounds r ON r.id = i.round WHERE i.version = ? ORDER BY r.number DESC`, version);
      return {
        id: artwork.id, size: artwork.size, number: artwork.number, filename: artwork.filename,
        entries: entries.map((entry) => ({ ...entry, feedback: entry.feedback ? JSON.parse(entry.feedback) : null })),
      };
    },
    artwork(version, { plan, token }) {
      let row;
      if (plan) row = ownedVersion(plan, version);
      else {
        const round = reviewByToken(token);
        row = get("SELECT v.* FROM items i JOIN versions v ON v.id = i.version WHERE i.round = ? AND v.id = ?", round.id, version);
        ensure(row, "This artwork is outside your review queue.", 404);
      }
      return { stream: createReadStream(path.join(files, row.id)), mime: row.mime, bytes: row.bytes };
    },
    close() { db.close(); },
  };
}

function cleanFeedback(value) {
  const { comment, notes, strokes, guides } = value ?? {};
  const text = (str, max) => typeof str === "string" && str.length <= max;
  const coord = (n) => Number.isFinite(n) && n >= 0 && n <= 1;
  const point = (p) => Array.isArray(p) && p.length === 2 && p.every(coord);
  ensure(text(comment, 4000) && Array.isArray(notes) && notes.length <= 50 &&
    Array.isArray(strokes) && strokes.length <= 100 && Array.isArray(guides) && guides.length <= 50, "Feedback exceeds the allowed limits.");
  ensure(notes.every((n) => n && point(n.point) && text(n.text, 1000) && n.text.trim()), "A canvas note is invalid.");
  ensure(strokes.every((s) => s && ["pen", "arrow", "box"].includes(s.kind) &&
    typeof s.colour === "string" && /^#[0-9a-f]{6}$/i.test(s.colour) && [2, 4, 8, 16].includes(s.width) &&
    Array.isArray(s.points) && s.points.length > 0 && s.points.length <= 400 && s.points.every(point) && text(s.note, 1000)),
    "A drawing annotation is invalid.");
  ensure(guides.every((g) => g && ["x", "y"].includes(g.axis) && coord(g.at)), "A guide is invalid.");
  return {
    comment: comment.trim(),
    notes: notes.map(({ point, text }) => ({ point, text: text.trim() })),
    strokes: strokes.map(({ kind, colour, width, points, note }) => ({ kind, colour, width, points, note: note.trim() })),
    guides: guides.map(({ axis, at }) => ({ axis, at })),
  };
}

export function imageInfo(b) {
  if (b.length < 24) return null;
  if (b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && b.toString("ascii", 12, 16) === "IHDR") {
    return { mime: "image/png", width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    for (let offset = 2; offset + 8 < b.length;) {
      if (b[offset++] !== 0xff) break;
      while (b[offset] === 0xff) offset++;
      const marker = b[offset++];
      const length = b.readUInt16BE(offset);
      if (length < 2 || marker === 0xda || marker === 0xd9) break;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker) && length >= 8) {
        return { mime: "image/jpeg", width: b.readUInt16BE(offset + 5), height: b.readUInt16BE(offset + 3) };
      }
      offset += length;
    }
  }
  if (b.length >= 30 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") {
    const kind = b.toString("ascii", 12, 16);
    if (kind === "VP8X") return { mime: "image/webp", width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
    if (kind === "VP8L" && b[20] === 0x2f) {
      const bits = b.readUInt32LE(21);
      return { mime: "image/webp", width: 1 + (bits & 0x3fff), height: 1 + ((bits >>> 14) & 0x3fff) };
    }
    if (kind === "VP8 " && b[23] === 0x9d && b[24] === 1 && b[25] === 0x2a) {
      return { mime: "image/webp", width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
    }
  }
  return null;
}

const SCHEMA = `
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 5000;
  CREATE TABLE IF NOT EXISTS formats (
    plan TEXT NOT NULL, size TEXT NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL,
    active INTEGER NOT NULL DEFAULT 1, position INTEGER NOT NULL, PRIMARY KEY(plan, size)
  );
  CREATE TABLE IF NOT EXISTS versions (
    id TEXT PRIMARY KEY, plan TEXT NOT NULL, size TEXT NOT NULL, number INTEGER NOT NULL,
    filename TEXT NOT NULL, mime TEXT NOT NULL, bytes INTEGER NOT NULL, sha256 TEXT NOT NULL,
    created TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft',
    UNIQUE(plan, size, number), FOREIGN KEY(plan, size) REFERENCES formats(plan, size)
  );
  CREATE TABLE IF NOT EXISTS rounds (
    id TEXT PRIMARY KEY, plan TEXT NOT NULL, number INTEGER NOT NULL, token_hash TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL, recipient TEXT NOT NULL, message TEXT NOT NULL, created TEXT NOT NULL, expires TEXT NOT NULL,
    revoked TEXT, completed TEXT, UNIQUE(plan, number)
  );
  CREATE TABLE IF NOT EXISTS items (
    round TEXT NOT NULL REFERENCES rounds(id), version TEXT NOT NULL REFERENCES versions(id),
    position INTEGER NOT NULL, decision TEXT, feedback TEXT, decided TEXT, PRIMARY KEY(round, version)
  );
  CREATE INDEX IF NOT EXISTS items_version ON items(version);
`;
