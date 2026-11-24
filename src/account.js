(async () => {
  try {
    const response = await fetch("/api/auth/status", { cache: "no-store" });
    if (!response.ok) return;
    const { user } = await response.json();
    const account = document.querySelector("#adaptAccount");
    if (!account || !user) return;
    const initials = String(user.name || user.email).split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
    document.querySelector("#adaptAccountInitials").textContent = initials;
    document.querySelector("#adaptAccountName").textContent = user.name || user.email;
    document.querySelector("#adaptAccountEmail").textContent = user.email;
    account.hidden = false;
    document.querySelector("#adaptSignOut").addEventListener("click", async () => {
      await fetch("/api/auth/logout", { method: "POST" });
      window.location.replace("/");
    });
  } catch {}
})();
