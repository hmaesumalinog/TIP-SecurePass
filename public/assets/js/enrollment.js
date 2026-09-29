/* Shared, required student onboarding. Enrollment is enforced by /api/profile. */
(() => {
  "use strict";
  let dialog;

  // iOS Safari only shows :active press feedback when a touch listener exists.
  document.addEventListener("touchstart", () => {}, { passive: true });

  // Set by the sign-in page right after a brand-new student saves a permanent
  // password and accepts the terms. Read once, then removed, so the welcome
  // never repeats on refresh, on another device, or for existing students.
  function takeWelcome() {
    try {
      const name = sessionStorage.getItem("securepass-welcome");
      if (name === null) return null;
      sessionStorage.removeItem("securepass-welcome");
      return name.trim().slice(0, 60);
    } catch {
      return null;
    }
  }

  const tick =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m6 12.5 4 4 8-9"/></svg>';

  const standard = `
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

  const welcome = `
      <div class="welcome-inner">
        <div class="welcome-mark" aria-hidden="true">
          <span class="welcome-ring"></span>
          <img src="assets/images/brand-mark.svg" width="44" height="52" alt="" />
        </div>
        <p class="enrollment-eyebrow welcome-eyebrow">You’re in</p>
        <h2 id="enrollment-title" tabindex="-1">Welcome to TIP SecurePass<span data-welcome-name></span>!</h2>
        <p id="enrollment-description" class="welcome-lead">Your account is almost ready. One quick step keeps it safe if you ever lose access to your email.</p>
        <ol class="welcome-checklist" aria-label="Account setup progress">
          <li class="is-done"><span class="welcome-tick">${tick}</span><span>Permanent password created</span></li>
          <li class="is-done"><span class="welcome-tick">${tick}</span><span>Terms and privacy notice accepted</span></li>
          <li class="is-next"><span class="welcome-tick">3</span><span><strong>Set up your authenticator</strong><small>Required once · about 3 minutes</small></span></li>
        </ol>
        <p data-enrollment-error role="alert" hidden></p>
        <div class="enrollment-actions welcome-actions">
          <button type="button" data-enrollment-setup>Let’s secure my account <span aria-hidden="true">→</span></button>
          <button type="button" class="enrollment-secondary" data-enrollment-signout>Sign out</button>
        </div>
        <a class="enrollment-help" href="recovery-help.html">Need help setting up? Contact the administrator</a>
      </div>`;

  function show({ onSetup } = {}) {
    if (dialog?.open) return;
    dialog?.remove();
    const welcomeName = takeWelcome();
    dialog = document.createElement("dialog");
    dialog.className =
      welcomeName === null
        ? "enrollment-dialog"
        : "enrollment-dialog welcome-dialog";
    dialog.setAttribute("aria-labelledby", "enrollment-title");
    dialog.setAttribute("aria-describedby", "enrollment-description");
    dialog.setAttribute("closedby", "none");
    dialog.innerHTML = welcomeName === null ? standard : welcome;
    if (welcomeName)
      dialog.querySelector("[data-welcome-name]").textContent =
        `, ${welcomeName}`;
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
        const open = () => {
          dialog.close();
          onSetup();
        };
        // The full-screen welcome fades away to reveal step 1 underneath.
        if (
          dialog.classList.contains("welcome-dialog") &&
          !matchMedia("(prefers-reduced-motion: reduce)").matches
        ) {
          setup.disabled = signout.disabled = true;
          dialog.classList.add("is-leaving");
          setTimeout(open, 220);
        } else open();
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
