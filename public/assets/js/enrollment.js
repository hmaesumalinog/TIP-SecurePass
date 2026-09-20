/* Shared, required student onboarding. Enrollment is enforced by /api/profile. */
(() => {
  "use strict";
  let dialog;

  function show({ onSetup } = {}) {
    if (dialog?.open) return;
    dialog?.remove();
    dialog = document.createElement("dialog");
    dialog.className = "enrollment-dialog";
    dialog.setAttribute("aria-labelledby", "enrollment-title");
    dialog.setAttribute("aria-describedby", "enrollment-description");
    dialog.setAttribute("closedby", "none");
    dialog.innerHTML = `
      <p class="enrollment-eyebrow">Account protection</p>
      <h2 id="enrollment-title" tabindex="-1">Set up your authenticator</h2>
      <p id="enrollment-description">Before you continue to the student portal, add an authenticator app so you can recover your account if you lose access to your email.</p>
      <ol>
        <li>Verify your identity with your portal password.</li>
        <li>Follow the guide to connect your authenticator app.</li>
        <li>Save the backup codes provided at the end.</li>
      </ol>
      <p class="enrollment-note">This is a one-time setup for new and existing students without an authenticator. Your usual sign-in still uses your student number and password.</p>
      <p data-enrollment-error role="alert" hidden></p>
      <div class="enrollment-actions">
        <button type="button" data-enrollment-setup>Set up authenticator</button>
        <button type="button" class="enrollment-secondary" data-enrollment-signout>Sign out</button>
      </div>
      <a class="enrollment-help" href="recovery-help.html">Need help setting up? Contact the administrator</a>`;
    document.body.appendChild(dialog);
    let openingSetup = false;
    dialog.addEventListener("cancel", (event) => event.preventDefault());
    dialog.addEventListener("keydown", (event) => {
      if (event.key === "Escape") event.preventDefault();
    });
    // Keep required onboarding visible in browsers with differing Escape behavior.
    dialog.addEventListener("close", () => {
      if (!openingSetup && dialog.isConnected && !dialog.open)
        dialog.showModal();
    });
    const setup = dialog.querySelector("[data-enrollment-setup]");
    const signout = dialog.querySelector("[data-enrollment-signout]");
    setup.addEventListener("click", () => {
      if (onSetup) {
        openingSetup = true;
        dialog.close();
        onSetup();
      } else {
        window.location.assign("security.html?onboarding=1&start=1");
      }
    });
    signout.addEventListener("click", async () => {
      setup.disabled = signout.disabled = true;
      signout.textContent = "Signing out…";
      const error = dialog.querySelector("[data-enrollment-error]");
      error.hidden = true;
      try {
        const response = await fetch("/api/logout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        if (!response.ok) throw new Error("Sign out failed");
        window.location.replace("index.html?signedOut=1");
      } catch {
        error.textContent =
          "We could not sign you out. Check your connection and try again.";
        error.hidden = false;
        setup.disabled = signout.disabled = false;
        signout.textContent = "Sign out";
      }
    });
    dialog.showModal();
    dialog.querySelector("h2").focus({ preventScroll: true });
    dialog.scrollTop = 0;
  }

  window.StudentEnrollment = { show };
})();
