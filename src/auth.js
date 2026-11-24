(async () => {
  const signInButton = document.querySelector("#signIn");
  const reconnectButton = document.querySelector("#reconnect");
  const signOutButton = document.querySelector("#signOut");
  const error = document.querySelector("#error");
  const copy = document.querySelector("#loginCopy");

  const showError = (message, { reconnect = false, signedIn = false } = {}) => {
    error.textContent = message;
    error.hidden = false;
    signInButton.hidden = signedIn || reconnect;
    reconnectButton.hidden = !reconnect;
    signOutButton.hidden = !signedIn;
    signInButton.disabled = reconnectButton.disabled = signOutButton.disabled = false;
  };

  const openPlanner = async (user) => {
    sessionStorage.setItem("adapt.user", JSON.stringify(user));
    const planner = await AdaptAuth.apiFetch("/api/planner", { cache: "no-store" });
    if (!planner.ok) throw new Error("Adapt could not load the protected planner.");
    const html = await planner.text();
    document.open();
    document.write(html);
    document.close();
  };

  try {
    const account = await AdaptAuth.initialise();
    if (!account) {
      signInButton.disabled = false;
      signInButton.addEventListener("click", () => AdaptAuth.signIn().catch((reason) => showError(reason.message)));
      return;
    }

    signInButton.hidden = true;
    copy.textContent = "Checking your Adapt access…";
    let response;
    try {
      response = await AdaptAuth.apiFetch("/api/me", { cache: "no-store" });
    } catch (reason) {
      if (reason?.reconnectRequired) {
        copy.textContent = "Your Microsoft account is still connected, but its access token needs refreshing.";
        return showError(reason.message, { reconnect: true, signedIn: true });
      }
      throw reason;
    }

    const payload = await response.json().catch(() => ({}));
    if (response.status === 403) {
      copy.textContent = `Signed in to Microsoft as ${account.username || "this account"}.`;
      return showError(payload.error || "This Microsoft account is not an active Adapt user.", { signedIn: true });
    }
    if (response.status === 401) {
      copy.textContent = "Your Microsoft account is still connected, but Adapt needs a fresh access token.";
      return showError(payload.error || "Reconnect Microsoft to continue.", { reconnect: true, signedIn: true });
    }
    if (!response.ok) throw new Error(payload.error || "Adapt access could not be checked.");
    await openPlanner(payload.user);
  } catch (reason) {
    showError(reason instanceof Error ? reason.message : "Microsoft sign-in could not be completed.");
  }

  reconnectButton.addEventListener("click", () => {
    reconnectButton.disabled = true;
    AdaptAuth.reconnect().catch((reason) => showError(reason.message, { reconnect: true, signedIn: true }));
  });
  signOutButton.addEventListener("click", () => AdaptAuth.signOut());
})();
