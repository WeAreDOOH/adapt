import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export function openAdaptDatabase(filename, { bootstrapEmail = "", bootstrapName = "Adapt Owner" } = {}) {
  mkdirSync(path.dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
  db.exec(SCHEMA);
  seedReferenceData(db);
  if (bootstrapEmail) seedOwner(db, bootstrapEmail, bootstrapName);

  return {
    authorize(identity) {
      return authorizeIdentity(db, identity);
    },
    listUsers() {
      return listUsers(db);
    },
    addUser(email, addedBy) {
      return addUser(db, email, addedBy);
    },
    removeUser(email, removedBy) {
      return removeUser(db, email, removedBy);
    },
    close() {
      db.close();
    },
  };
}

function authorizeIdentity(db, identity) {
  const email = normaliseEmail(identity.email);
  if (!email) return null;
  const user = db.prepare(`
    SELECT id, email, display_name, is_active
    FROM users WHERE lower(email) = ? LIMIT 1
  `).get(email);

  if (!user || user.is_active !== 1) return null;

  const now = new Date().toISOString();
  db.prepare(`
    UPDATE users SET last_login_at = ?, display_name = CASE
      WHEN display_name = '' THEN ? ELSE display_name END
    WHERE id = ?
  `).run(now, identity.name || identity.email, user.id);

  const roles = db.prepare(`
    SELECT r.name FROM roles r
    JOIN user_roles ur ON ur.role_id = r.id
    WHERE ur.user_id = ? ORDER BY r.name
  `).all(user.id).map((row) => row.name);

  const organisationPermissions = db.prepare(`
    SELECT o.slug AS organisation, p.key AS permission
    FROM user_organisation_permissions uop
    JOIN organisations o ON o.id = uop.organisation_id AND o.is_active = 1
    JOIN permissions p ON p.id = uop.permission_id
    WHERE uop.user_id = ? ORDER BY o.slug, p.key
  `).all(user.id).map((row) => ({
    organisation: row.organisation,
    permission: row.permission,
  }));

  return {
    id: user.id,
    email: user.email,
    name: user.display_name || identity.name || user.email,
    roles,
    organisationPermissions,
  };
}

function listUsers(db) {
  return db.prepare(`
    SELECT u.id, u.email, u.display_name AS name, u.is_active AS active,
      COALESCE(group_concat(r.name, ','), '') AS roles
    FROM users u
    LEFT JOIN user_roles ur ON ur.user_id = u.id
    LEFT JOIN roles r ON r.id = ur.role_id
    GROUP BY u.id
    ORDER BY u.email
  `).all().map((row) => ({
    id: row.id,
    email: row.email,
    name: row.name,
    active: row.active === 1,
    roles: row.roles ? row.roles.split(',').sort() : [],
  }));
}

function addUser(db, emailValue, addedBy) {
  const email = validateEmail(emailValue);
  const timestamp = new Date().toISOString();
  db.prepare(`
    INSERT INTO users (email, display_name, is_active, created_at)
    VALUES (?, ?, 1, ?)
    ON CONFLICT(email) DO UPDATE SET is_active = 1
  `).run(email, email, timestamp);

  const user = db.prepare("SELECT id FROM users WHERE lower(email) = ?").get(email);
  const role = db.prepare("SELECT id FROM roles WHERE name = 'user'").get();
  const organisation = db.prepare("SELECT id FROM organisations WHERE slug = 'dooh-com'").get();
  db.prepare("INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)").run(user.id, role.id);
  const permissions = db.prepare("SELECT id FROM permissions WHERE key IN ('adapt.use', 'adapt.export')").all();
  const assign = db.prepare(`
    INSERT OR IGNORE INTO user_organisation_permissions
      (user_id, organisation_id, permission_id) VALUES (?, ?, ?)
  `);
  for (const permission of permissions) assign.run(user.id, organisation.id, permission.id);
  db.prepare("UPDATE users SET added_by = COALESCE(added_by, ?) WHERE id = ?")
    .run(normaliseEmail(addedBy), user.id);
  return listUsers(db);
}

function removeUser(db, emailValue, removedBy) {
  const email = validateEmail(emailValue);
  if (email === normaliseEmail(removedBy)) throw new Error("You cannot remove your own access.");
  const candidate = db.prepare(`
    SELECT u.id, EXISTS(
      SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = u.id AND r.name = 'owner'
    ) AS is_owner
    FROM users u WHERE lower(u.email) = ?
  `).get(email);
  if (!candidate) return listUsers(db);
  if (candidate.is_owner) throw new Error("The Adapt owner cannot be removed from this panel.");
  db.prepare("UPDATE users SET is_active = 0 WHERE id = ?").run(candidate.id);
  return listUsers(db);
}

function seedReferenceData(db) {
  db.exec(`
    INSERT OR IGNORE INTO roles (name) VALUES ('owner'), ('user');
    INSERT OR IGNORE INTO organisations (slug, name, is_active) VALUES ('dooh-com', 'DOOH.COM', 1);
    INSERT OR IGNORE INTO permissions (key, name) VALUES
      ('adapt.use', 'Use Adapt'),
      ('adapt.export', 'Export Adapt files'),
      ('adapt.manage_users', 'Manage Adapt users');
  `);
}

function seedOwner(db, emailValue, displayName) {
  const email = normaliseEmail(emailValue);
  if (!email) return;
  db.prepare(`
    INSERT INTO users (email, display_name, is_active, created_at)
    VALUES (?, ?, 1, ?)
    ON CONFLICT(email) DO NOTHING
  `).run(email, displayName, new Date().toISOString());

  const user = db.prepare("SELECT id FROM users WHERE lower(email) = ?").get(email);
  const owner = db.prepare("SELECT id FROM roles WHERE name = 'owner'").get();
  const organisation = db.prepare("SELECT id FROM organisations WHERE slug = 'dooh-com'").get();
  db.prepare("INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)").run(user.id, owner.id);
  const permissions = db.prepare("SELECT id FROM permissions").all();
  const assign = db.prepare(`
    INSERT OR IGNORE INTO user_organisation_permissions
      (user_id, organisation_id, permission_id) VALUES (?, ?, ?)
  `);
  for (const permission of permissions) assign.run(user.id, organisation.id, permission.id);
}

function normaliseEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function validateEmail(value) {
  const email = normaliseEmail(value);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid email address.");
  return email;
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL COLLATE NOCASE UNIQUE,
    display_name TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at TEXT NOT NULL,
    last_login_at TEXT,
    added_by TEXT
  );
  CREATE TABLE IF NOT EXISTS roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE
  );
  CREATE TABLE IF NOT EXISTS user_roles (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, role_id)
  );
  CREATE TABLE IF NOT EXISTS organisations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))
  );
  CREATE TABLE IF NOT EXISTS permissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS user_organisation_permissions (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, organisation_id, permission_id)
  );
`;
