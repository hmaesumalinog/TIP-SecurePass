(function () {
  "use strict";

  const text = (id, value, fallback = "Not provided") => {
    const element = document.getElementById(id);
    if (element) element.textContent = value ?? fallback;
  };

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
      document.querySelectorAll("[data-loading]").forEach((element) => {
        element.textContent =
          "Authenticator setup is required before you can open the portal.";
      });
      window.StudentEnrollment.show();
      return null;
    }
    if (!response.ok)
      throw new Error(
        data.message || "The student profile could not be loaded.",
      );
    return data.student;
  }

  async function signOut(confirmButton) {
    const navigationButton = document.getElementById("sign-out");
    if (navigationButton) {
      navigationButton.disabled = true;
      navigationButton.textContent = "Signing out…";
    }
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
    dialog.className = "sign-out-dialog";
    dialog.setAttribute("aria-labelledby", "sign-out-dialog-title");
    dialog.setAttribute("aria-describedby", "sign-out-dialog-description");
    dialog.innerHTML = `
      <div class="sign-out-dialog-card">
        <div class="sign-out-dialog-icon" aria-hidden="true">↪</div>
        <h2 id="sign-out-dialog-title">Confirm sign out</h2>
        <p id="sign-out-dialog-description">Are you sure you want to sign out of the student portal?</p>
        <div class="sign-out-dialog-actions">
          <button type="button" class="dialog-button secondary" data-cancel-sign-out>Cancel</button>
          <button type="button" class="dialog-button primary" data-confirm-sign-out>Sign out</button>
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

  loadProfile()
    .then((student) => {
      if (!student) return;
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
      text("profile-birthday", student.birthday);
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
    })
    .catch((error) => {
      document.querySelectorAll("[data-loading]").forEach((element) => {
        element.textContent = error.message;
      });
    });
})();
