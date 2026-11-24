(async () => {
  const list = document.querySelector("#users");
  const count = document.querySelector("#count");
  const form = document.querySelector("#addUser");
  const email = document.querySelector("#email");
  const notice = document.querySelector("#notice");
  const error = document.querySelector("#error");
  let currentEmail = "";

  const message = (text, failed = false) => {
    notice.hidden = failed || !text;
    error.hidden = !failed || !text;
    (failed ? error : notice).textContent = text;
  };

  const render = (users) => {
    count.textContent = String(users.filter((user) => user.active).length).padStart(2, "0");
    list.replaceChildren(...users.filter((user) => user.active).map((user) => {
      const row = document.createElement("article");
      row.className = "row";
      const details = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = user.email;
      const meta = document.createElement("span");
      meta.textContent = user.roles.includes("owner") ? "Owner" : "User";
      details.append(title, meta);
      if (user.email.toLowerCase() === currentEmail) {
        const you = document.createElement("em");
        you.textContent = "You";
        row.append(details, you);
      } else if (!user.roles.includes("owner")) {
        const remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = "Remove";
        remove.addEventListener("click", () => update("DELETE", user.email, remove));
        row.append(details, remove);
      } else {
        row.append(details, document.createElement("span"));
      }
      return row;
    }));
  };

  const update = async (method, candidate, button) => {
    button.disabled = true;
    message("");
    try {
      const response = await AdaptAuth.apiFetch("/api/admin/users", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: candidate }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "The user list could not be updated.");
      render(payload.users);
      message(method === "POST" ? `${candidate} can now sign in.` : `${candidate} no longer has access.`);
    } catch (reason) {
      message(reason instanceof Error ? reason.message : "The user list could not be updated.", true);
    } finally {
      button.disabled = false;
    }
  };

  try {
    const meResponse = await AdaptAuth.apiFetch("/api/me", { cache: "no-store" });
    const me = await meResponse.json().catch(() => ({}));
    if (!meResponse.ok) throw new Error(me.error || "Sign in to manage Adapt users.");
    if (!me.user.organisationPermissions?.some((entry) => entry.permission === "adapt.manage_users")) {
      throw new Error("Owner access is required.");
    }
    currentEmail = me.user.email.toLowerCase();
    const response = await AdaptAuth.apiFetch("/api/admin/users", { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "The user list could not be loaded.");
    render(payload.users);
  } catch (reason) {
    form.hidden = true;
    message(reason instanceof Error ? reason.message : "The user list could not be loaded.", true);
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const candidate = email.value.trim().toLowerCase();
    if (!candidate) return;
    await update("POST", candidate, form.querySelector("button"));
    if (error.hidden) email.value = "";
  });
})();
