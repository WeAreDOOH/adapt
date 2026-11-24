(async () => {
  const button = document.querySelector("#signIn");
  const error = document.querySelector("#error");
  const showError = (reason) => {
    error.textContent = reason instanceof Error ? reason.message : String(reason || "Microsoft sign-in failed.");
    error.hidden = false;
    button.disabled = false;
    button.firstElementChild.textContent = "Sign in with Microsoft";
  };

  try {
    const response = await fetch("/api/auth/config", { cache: "no-store" });
    const config = await response.json();
    if (!response.ok || !config.tenantId || !config.clientId || !config.apiScope) throw new Error(config.error || "Microsoft sign-in is not configured.");

    const client = new msal.PublicClientApplication({
      auth: { clientId: config.clientId, authority: `https://login.microsoftonline.com/${config.tenantId}`, redirectUri: window.location.origin, postLogoutRedirectUri: window.location.origin },
      cache: { cacheLocation: "sessionStorage" },
    });
    await client.initialize();

    const finish = async (result) => {
      if (!result?.accessToken) return false;
      const session = await fetch("/api/auth/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accessToken: result.accessToken }) });
      const payload = await session.json().catch(() => ({}));
      if (!session.ok) throw new Error(payload.error || "Your Microsoft account could not be verified.");
      window.location.replace("/");
      return true;
    };

    const redirectResult = await client.handleRedirectPromise();
    if (redirectResult) {
      button.disabled = true;
      button.firstElementChild.textContent = "Checking Microsoft account…";
      await finish(redirectResult);
      return;
    }

    button.addEventListener("click", async () => {
      button.disabled = true;
      button.firstElementChild.textContent = "Opening Microsoft…";
      error.hidden = true;
      try { await client.loginRedirect({ scopes: [config.apiScope], redirectStartPage: window.location.href }); }
      catch (reason) { showError(reason); }
    });
  } catch (reason) { showError(reason); }
})();
