(function () {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const text = (id, value, fallback = "Not provided") => {
    const element = document.getElementById(id);
    if (element) element.textContent = value ?? fallback;
  };

  // Birthdays arrive as ISO dates; show them the way people read dates.
  function readableDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return value;
    const date = new Date(`${value}T00:00:00Z`);
    if (!Number.isFinite(date.getTime())) return value;
    return new Intl.DateTimeFormat("en", {
      dateStyle: "long",
      timeZone: "UTC",
    }).format(date);
  }

  function showState(message, retry = true) {
    document.querySelectorAll("[data-loading]").forEach((element) => {
      const box = document.createElement("div");
      box.className = "state-message";
      const copy = document.createElement("p");
      copy.textContent = message;
      box.append(copy);
      if (retry) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "ui-btn";
        button.textContent = "Try again";
        button.addEventListener("click", () => location.reload());
        box.append(button);
      }
      element.removeAttribute("aria-label");
      element.replaceChildren(box);
    });
  }

  async function loadProfile() {
    let response;
    try {
      response = await fetch("/api/profile", {
        headers: { Accept: "application/json" },
      });
    } catch {
      throw new Error(
        "We could not reach the server. Check your internet connection and try again.",
      );
    }
    if (response.status === 401) {
      window.location.replace("index.html?session=expired");
      return null;
    }
    const data = await response.json().catch(() => ({}));
    if (response.status === 403 && data.code === "POLICIES_REQUIRED") {
      location.replace("security.html?onboarding=1");
      return null;
    }
    if (
      response.status === 403 &&
      data.code === "AUTHENTICATOR_SETUP_REQUIRED"
    ) {
      showState(
        "Authenticator setup is required before you can open the portal.",
        false,
      );
      window.StudentEnrollment.show();
      return null;
    }
    if (!response.ok)
      throw new Error(
        data.message || "The student profile could not be loaded.",
      );
    return data;
  }

  // A read-only summary of the student's recovery methods for the dashboard.
  function loadSecuritySummary(status) {
    const card = $("#security-card");
    if (!card) return;
    if (status?.status !== "ok" || typeof status.enabled !== "boolean") return;
    const remaining = Number(status.remaining) || 0;
    const pills = [
      status.enabled
        ? ["ok", "Authenticator connected"]
        : ["warn", "Authenticator not set up"],
      remaining > 2
        ? ["ok", `${remaining} backup codes`]
        : [
            "warn",
            remaining
              ? `Only ${remaining} backup code${remaining === 1 ? "" : "s"} left`
              : "No backup codes left",
          ],
      status.phoneVerified
        ? ["ok", "Recovery phone verified"]
        : ["", "No recovery phone (optional)"],
    ];
    const list = $("#security-pills");
    list.replaceChildren(
      ...pills.map(([tone, label]) => {
        const item = document.createElement("li");
        item.className = `security-pill ${tone}`.trim();
        item.textContent = label;
        return item;
      }),
    );
    const attention = !status.enabled || remaining <= 2;
    card.classList.toggle("needs-attention", attention);
    const hint = $("#security-card-hint");
    hint.textContent = !status.enabled
      ? "Connect an authenticator so you can recover your account without email."
      : remaining <= 2
        ? "Create a new set of backup codes so you can still recover without email."
        : status.phoneVerified
          ? ""
          : "Optional: verify a phone number for another way back in.";
    hint.hidden = !hint.textContent;
    $("#security-card-link").textContent = attention
      ? "Fix now"
      : "Manage security";
    card.classList.remove("hidden");
  }

  async function signOut(confirmButton) {
    const navigationButton = document.getElementById("sign-out");
    if (navigationButton) navigationButton.disabled = true;
    if (confirmButton) {
      confirmButton.disabled = true;
      confirmButton.textContent = "Signing out…";
    }
    try {
      await fetch("/api/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
    } finally {
      window.location.replace("index.html?signedOut=1");
    }
  }

  function initializeSignOutDialog() {
    const signOutButton = document.getElementById("sign-out");
    if (!signOutButton) return;

    const dialog = document.createElement("dialog");
    dialog.className = "ui-dialog";
    dialog.setAttribute("aria-labelledby", "sign-out-dialog-title");
    dialog.setAttribute("aria-describedby", "sign-out-dialog-description");
    dialog.innerHTML = `
      <div class="ui-dialog-card">
        <div class="ui-dialog-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="m10 16-4-4 4-4"/><path d="M6 12h10"/></svg></div>
        <h2 id="sign-out-dialog-title">Sign out of the portal?</h2>
        <p id="sign-out-dialog-description">You’ll need your student number and password to sign in again.</p>
        <div class="ui-dialog-actions">
          <button type="button" class="ui-btn secondary" data-cancel-sign-out>Stay signed in</button>
          <button type="button" class="ui-btn" data-confirm-sign-out>Sign out</button>
        </div>
      </div>`;
    document.body.appendChild(dialog);

    const cancelButton = dialog.querySelector("[data-cancel-sign-out]");
    const confirmButton = dialog.querySelector("[data-confirm-sign-out]");

    signOutButton.addEventListener("click", () => {
      dialog.showModal();
      cancelButton.focus();
    });
    cancelButton.addEventListener("click", () => dialog.close());
    confirmButton.addEventListener("click", () => signOut(confirmButton));
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });
    dialog.addEventListener("close", () => {
      if (!signOutButton.disabled) signOutButton.focus();
    });
  }

  initializeSignOutDialog();

  const today = $("#today-label");
  if (today)
    today.textContent = new Intl.DateTimeFormat("en", {
      weekday: "long",
      month: "short",
      day: "numeric",
    }).format(new Date());

  loadProfile()
    .then((data) => {
      if (!data) return;
      const { student, recovery } = data;
      const initials =
        `${student.firstName?.[0] || ""}${student.lastName?.[0] || ""}`.toUpperCase() ||
        "ST";
      text("student-first-name", student.firstName, "Student");
      text("profile-name", student.fullName);
      text("profile-name-copy", student.fullName);
      text("profile-initials", initials);
      text("profile-student-number", student.studentNumber);
      text("profile-student-number-copy", student.studentNumber);
      text("profile-email", student.email);
      text("profile-age", student.age);
      text("profile-birthday", readableDate(student.birthday));
      text("profile-phone", student.phone);
      text("profile-program", student.program);
      text("profile-program-copy", student.program);
      text("profile-year-level", student.yearLevel);
      text("profile-year-level-copy", student.yearLevel);
      document
        .querySelectorAll("[data-protected-content]")
        .forEach((element) => element.classList.remove("hidden"));
      document
        .querySelectorAll("[data-loading]")
        .forEach((element) => element.classList.add("hidden"));
      if (document.body.dataset.page === "portal")
        loadSecuritySummary(recovery);
    })
    .catch((error) => showState(error.message));
})();
