import { createRemoteJWKSet, jwtVerify } from "jose";

export class AuthenticationError extends Error {
  constructor(message, code = "invalid_token") {
    super(message);
    this.name = "AuthenticationError";
    this.code = code;
  }
}

export function createEntraVerifier({ tenantId, apiClientId, spaClientId, keySet } = {}) {
  if (!tenantId || !apiClientId || !spaClientId) {
    throw new Error("Adapt Entra authentication configuration is incomplete.");
  }

  const authority = `https://login.microsoftonline.com/${tenantId}/v2.0`;
  const issuer = authority;
  const keys = keySet ?? createRemoteJWKSet(
    new URL(`https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`),
  );

  return {
    authority,
    async verify(token) {
      if (!token) throw new AuthenticationError("A bearer token is required.", "missing_token");

      let result;
      try {
        result = await jwtVerify(token, keys, {
          issuer,
          audience: [apiClientId, `api://${apiClientId}`],
        });
      } catch {
        throw new AuthenticationError("The Microsoft access token is invalid or expired.");
      }

      const claims = result.payload;
      if (claims.tid !== tenantId) {
        throw new AuthenticationError("The Microsoft access token belongs to the wrong tenant.");
      }
      if (claims.azp !== spaClientId) {
        throw new AuthenticationError("The Microsoft access token was not issued to the Adapt SPA.");
      }
      const scopes = typeof claims.scp === "string" ? claims.scp.split(/\s+/) : [];
      if (!scopes.includes("access_as_user")) {
        throw new AuthenticationError("The Microsoft access token is missing the Adapt API scope.", "insufficient_scope");
      }
      if (typeof claims.oid !== "string" || !claims.oid) {
        throw new AuthenticationError("The Microsoft access token has no object identifier.");
      }

      const email = firstString(claims.preferred_username, claims.email, claims.upn).toLowerCase();
      return {
        oid: claims.oid,
        email,
        name: firstString(claims.name, email),
        tenantId: claims.tid,
      };
    },
  };
}

export function bearerToken(request) {
  const value = request.headers.authorization || "";
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || "";
}

function firstString(...values) {
  return values.find((value) => typeof value === "string" && value.trim())?.trim() || "";
}
