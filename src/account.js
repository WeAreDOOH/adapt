(async () => {
  if (!window.AdaptAuth) return;
  try {
    const user = JSON.parse(sessionStorage.getItem("adapt.user") || "null");
    const account = document.querySelector("#adaptAccount");
    if (!account || !user) return;
    const initials = String(user.name || user.email).split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
    document.querySelector("#adaptAccountInitials").textContent = initials;
    document.querySelector("#adaptAccountName").textContent = user.name || user.email;
    document.querySelector("#adaptAccountEmail").textContent = user.email;
    const manage = document.querySelector("#adaptManageUsers");
    if (manage && user.organisationPermissions?.some((entry) => entry.permission === "adapt.manage_users")) manage.hidden = false;
    account.hidden = false;
    document.querySelector("#adaptReconnect").addEventListener("click", () => AdaptAuth.reconnect());
    document.querySelector("#adaptSignOut").addEventListener("click", () => AdaptAuth.signOut());
  } catch {}
})();
