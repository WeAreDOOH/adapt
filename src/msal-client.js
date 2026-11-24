(() => {
  let client = null;
  let config = null;
  let initialising = null;

  class ReconnectRequiredError extends Error {
    constructor(message) {
      super(message);
      this.name = "ReconnectRequiredError";
      this.reconnectRequired = true;
    }
  }

  const initialise = async () => {
    if (initialising) return initialising;
    initialising = (async () => {
      const response = await fetch("/api/auth/config", { cache: "no-store" });
      config = await response.json();
      if (!response.ok || !config.tenantId || !config.clientId || !config.apiScope) {
        throw new Error(config.error || "Microsoft sign-in is not configured.");
      }
      client = new msal.PublicClientApplication({
        auth: {
          clientId: config.clientId,
          authority: `https://login.microsoftonline.com/${config.tenantId}`,
          redirectUri: window.location.origin,
          postLogoutRedirectUri: window.location.origin,
        },
        cache: { cacheLocation: "localStorage" },
      });
      await client.initialize();
      const redirectResult = await client.handleRedirectPromise();
      const account = redirectResult?.account ?? client.getAllAccounts()[0] ?? null;
      if (account) client.setActiveAccount(account);
      return account;
    })();
    return initialising;
  };

  const account = () => client?.getActiveAccount() ?? client?.getAllAccounts()[0] ?? null;

  const signIn = async () => {
    await initialise();
    await client.loginRedirect({ scopes: [config.apiScope], redirectStartPage: window.location.href });
  };

  const reconnect = async () => {
    await initialise();
    const current = account();
    if (!current) return signIn();
    await client.acquireTokenRedirect({
      account: current,
      scopes: [config.apiScope],
      redirectStartPage: window.location.href,
    });
  };

  const signOut = async () => {
    await initialise();
    sessionStorage.removeItem("adapt.user");
    await client.logoutRedirect({ account: account() ?? undefined, postLogoutRedirectUri: window.location.origin });
  };

  const accessToken = async () => {
    await initialise();
    const current = account();
    if (!current) return null;
    try {
      return (await client.acquireTokenSilent({ account: current, scopes: [config.apiScope] })).accessToken;
    } catch (reason) {
      const code = reason?.errorCode || "";
      if (reason instanceof msal.InteractionRequiredAuthError) {
        throw new ReconnectRequiredError("Your Microsoft session needs refreshing. Choose Reconnect Microsoft to continue without signing out.");
      }
      if (code === "timed_out" || code === "monitor_window_timeout") {
        throw new ReconnectRequiredError("Microsoft did not refresh the session in time. Choose Reconnect Microsoft to continue without signing out.");
      }
      throw reason;
    }
  };

  const apiFetch = async (input, init = {}) => {
    const token = await accessToken();
    if (!token) throw new ReconnectRequiredError("Microsoft sign-in is required.");
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token}`);
    return fetch(input, { ...init, headers });
  };

  window.AdaptAuth = { initialise, account, signIn, reconnect, signOut, accessToken, apiFetch, ReconnectRequiredError };
})();
