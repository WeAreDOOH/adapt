import assert from "node:assert/strict";
import test from "node:test";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { AuthenticationError, createEntraVerifier } from "../lib/entra.mjs";

const tenantId = "tenant-id";
const apiClientId = "api-client-id";
const spaClientId = "spa-client-id";
const { publicKey, privateKey } = await generateKeyPair("RS256");
const jwk = { ...(await exportJWK(publicKey)), kid: "adapt-test", use: "sig", alg: "RS256" };
const keySet = createLocalJWKSet({ keys: [jwk] });
const verifier = createEntraVerifier({ tenantId, apiClientId, spaClientId, keySet });

const token = (overrides = {}) => new SignJWT({
  tid: tenantId,
  oid: "object-id",
  azp: spaClientId,
  scp: "access_as_user",
  preferred_username: "owner@dooh.com",
  name: "Adapt Owner",
  ...overrides,
})
  .setProtectedHeader({ alg: "RS256", kid: "adapt-test" })
  .setIssuer(`https://login.microsoftonline.com/${tenantId}/v2.0`)
  .setAudience(apiClientId)
  .setIssuedAt()
  .setExpirationTime("5m")
  .sign(privateKey);

test("validates authority, issuer, audience, client and delegated scope", async () => {
  const identity = await verifier.verify(await token());
  assert.deepEqual(identity, {
    oid: "object-id",
    email: "owner@dooh.com",
    name: "Adapt Owner",
    tenantId,
  });
});

test("rejects a token issued to another API audience", async () => {
  const wrongAudience = await new SignJWT({ tid: tenantId, oid: "object-id", azp: spaClientId, scp: "access_as_user" })
    .setProtectedHeader({ alg: "RS256", kid: "adapt-test" })
    .setIssuer(`https://login.microsoftonline.com/${tenantId}/v2.0`)
    .setAudience("another-api")
    .setExpirationTime("5m")
    .sign(privateKey);
  await assert.rejects(() => verifier.verify(wrongAudience), AuthenticationError);
});

test("rejects a different SPA or a token without access_as_user", async () => {
  const wrongSpa = await token({ azp: "another-spa" });
  const wrongScope = await token({ scp: "openid profile" });
  await assert.rejects(() => verifier.verify(wrongSpa), AuthenticationError);
  await assert.rejects(() => verifier.verify(wrongScope), AuthenticationError);
});
