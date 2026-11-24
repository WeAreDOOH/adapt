import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { openAdaptDatabase } from "../lib/database.mjs";

test("authorises every login by verified email and keeps roles and permissions in Adapt", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "adapt-db-"));
  const filename = path.join(directory, "adapt.sqlite");
  const database = openAdaptDatabase(filename, { bootstrapEmail: "Owner@DOOH.com", bootstrapName: "Adapt Owner" });

  const first = database.authorize({ oid: "oid-one", email: "owner@dooh.com", name: "Microsoft Name" });
  assert.equal(first.email, "owner@dooh.com");
  assert.deepEqual(first.roles, ["owner"]);
  assert.deepEqual(first.organisationPermissions, [
    { organisation: "dooh-com", permission: "adapt.export" },
    { organisation: "dooh-com", permission: "adapt.manage_users" },
    { organisation: "dooh-com", permission: "adapt.use" },
  ]);

  assert.equal(database.authorize({ oid: "oid-one", email: "changed@dooh.com", name: "Changed" }), null);
  assert.equal(database.authorize({ oid: "oid-two", email: "owner@dooh.com", name: "Second Microsoft object" }).id, first.id);
  assert.equal(database.authorize({ oid: "unknown", email: "unknown@dooh.com", name: "Unknown" }), null);
  database.close();

  const raw = new DatabaseSync(filename);
  raw.prepare("UPDATE users SET is_active = 0 WHERE email = ?").run("owner@dooh.com");
  raw.close();
  const reopened = openAdaptDatabase(filename);
  assert.equal(reopened.authorize({ oid: "oid-one", email: "owner@dooh.com", name: "Owner" }), null);
  reopened.close();
  rmSync(directory, { recursive: true, force: true });
});

test("owner manages the app email list without changing Entra", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "adapt-db-"));
  const filename = path.join(directory, "adapt.sqlite");
  const database = openAdaptDatabase(filename, { bootstrapEmail: "owner@dooh.com" });
  database.addUser("Colleague@dooh.com", "owner@dooh.com");
  const colleague = database.authorize({ oid: "any-oid", email: "colleague@dooh.com", name: "Colleague" });
  assert.deepEqual(colleague.roles, ["user"]);
  assert.deepEqual(colleague.organisationPermissions, [
    { organisation: "dooh-com", permission: "adapt.export" },
    { organisation: "dooh-com", permission: "adapt.use" },
  ]);
  assert.throws(() => database.removeUser("owner@dooh.com", "owner@dooh.com"), /own access/);
  database.removeUser("colleague@dooh.com", "owner@dooh.com");
  assert.equal(database.authorize({ oid: "any-oid", email: "colleague@dooh.com", name: "Colleague" }), null);
  database.close();
  rmSync(directory, { recursive: true, force: true });
});
