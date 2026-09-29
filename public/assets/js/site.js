(function () {
  "use strict";

  const page = document.body.dataset.page;
  const $ = (selector, parent = document) => parent.querySelector(selector);
  const $$ = (selector, parent = document) => [
    ...parent.querySelectorAll(selector),
  ];

  function setButtonBusy(button, busy, label) {
    if (!button) return;
    if (busy) {
      button.dataset.label = button.innerHTML;
      button.disabled = true;
      button.innerHTML = `<span class="loading" aria-hidden="true"></span>${label}`;
    } else {
      button.disabled = false;
      button.innerHTML = button.dataset.label || label;
    }
  }

  // Replays a short shake so a failed attempt is noticed without reading.
  function shake(node) {
    if (!node) return;
    node.classList.remove("is-shaking");
    void node.offsetWidth;
    node.classList.add("is-shaking");
  }
  // iOS Safari only shows :active press feedback when a touch listener exists.
  document.addEventListener("touchstart", () => {}, { passive: true });

  // The security page greets brand-new students once. Only the first name is
  // kept, for this tab only, and it is removed as soon as the welcome shows.
  function rememberWelcome(firstName) {
    try {
      sessionStorage.setItem("securepass-welcome", firstName || "");
    } catch {
      // Storage can be unavailable (private modes); the plain setup prompt shows.
    }
  }

  const NETWORK_ERROR =
    "We could not reach the server. Check your internet connection and try again.";

  async function postJson(url, body) {
    let response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(body),
      });
    } catch {
      throw new Error(NETWORK_ERROR);
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(
        data.message || "We could not complete that request. Please try again.",
      );
      error.status = response.status;
      throw error;
    }
    return data;
  }

  // Mirrors the server policy: 12–128 characters, mixed case, a number, a
  // symbol, and not the student's own number.
  function passwordRules(value, studentNumber = "") {
    return {
      length: value.length >= 12 && value.length <= 128,
      case: /[A-Z]/.test(value) && /[a-z]/.test(value),
      number: /\d/.test(value),
      symbol: /[^A-Za-z0-9]/.test(value),
      student: /^\d{7}$/.test(studentNumber)
        ? !value.includes(studentNumber)
        : !/\d{7}/.test(value),
    };
  }

  $$("[data-reveal]").forEach((button) => {
    button.addEventListener("click", () => {
      const input = document.getElementById(button.dataset.reveal);
      const revealing = input.type === "password";
      input.type = revealing ? "text" : "password";
      button.textContent = revealing ? "Hide" : "Show";
      button.setAttribute("aria-pressed", String(revealing));
      button.setAttribute(
        "aria-label",
        button
          .getAttribute("aria-label")
          .replace(/^(Show|Hide)/, revealing ? "Hide" : "Show"),
      );
    });
  });

  $$("[data-caps]").forEach((input) => {
    const hint = document.getElementById(input.dataset.caps);
    const update = (event) => {
      if (typeof event.getModifierState === "function")
        hint.hidden = !event.getModifierState("CapsLock");
    };
    input.addEventListener("keydown", update);
    input.addEventListener("keyup", update);
    input.addEventListener("blur", () => (hint.hidden = true));
  });

  if (page === "login") {
    const form = $("#login-form");
    const studentNumber = $("#student-id");
    const password = $("#password");
    const error = $("#login-error");
    const submit = $('button[type="submit"]', form);
    const firstLoginDialog = $("#first-login-dialog");
    const firstLoginForm = $("#first-login-form");
    const firstLoginPassword = $("#first-login-password");
    const firstLoginConfirm = $("#first-login-confirm");
    const firstLoginError = $("#first-login-error");
    const firstLoginMatch = $("#first-login-match");
    let firstName = "";

    showReturnNotice();

    studentNumber?.addEventListener("input", () => {
      studentNumber.value = studentNumber.value.replace(/\D/g, "").slice(0, 7);
      studentNumber.removeAttribute("aria-invalid");
      error.textContent = "";
    });
    password?.addEventListener("input", () => {
      password.removeAttribute("aria-invalid");
      error.textContent = "";
    });

    form?.addEventListener("submit", async (event) => {
      event.preventDefault();
      error.textContent = "";
      studentNumber.removeAttribute("aria-invalid");
      password.removeAttribute("aria-invalid");
      if (!/^\d{7}$/.test(studentNumber.value)) {
        studentNumber.setAttribute("aria-invalid", "true");
        error.textContent = "Enter your 7-digit student number.";
        shake(form);
        studentNumber.focus();
        return;
      }
      if (!password.value) {
        password.setAttribute("aria-invalid", "true");
        error.textContent = "Enter your password.";
        shake(form);
        password.focus();
        return;
      }

      setButtonBusy(submit, true, "Signing in…");
      try {
        const data = await postJson("/api/login", {
          studentNumber: studentNumber.value,
          password: password.value,
        });
        if (data.requiresPasswordChange) {
          firstName = data.student?.firstName || "";
          password.value = "";
          firstLoginDialog.showModal();
          firstLoginPassword.focus();
        } else {
          window.location.assign("portal.html");
        }
      } catch (loginError) {
        error.textContent = loginError.message;
        shake(form);
        password.select();
      } finally {
        setButtonBusy(submit, false, "Sign in to student portal");
      }
    });

    function updateFirstLogin() {
      const rules = passwordRules(
        firstLoginPassword.value,
        studentNumber.value,
      );
      Object.entries(rules).forEach(([name, met]) =>
        $(`[data-first-rule="${name}"]`, firstLoginDialog).classList.toggle(
          "is-valid",
          !!firstLoginPassword.value && met,
        ),
      );
      const confirmation = firstLoginConfirm.value;
      const matches =
        !!confirmation && confirmation === firstLoginPassword.value;
      firstLoginMatch.textContent = matches
        ? "Passwords match."
        : confirmation
          ? "The passwords don’t match yet."
          : "Enter the same password again.";
      firstLoginMatch.classList.toggle("is-valid", matches);
      firstLoginError.textContent = "";
    }
    firstLoginPassword?.addEventListener("input", updateFirstLogin);
    firstLoginConfirm?.addEventListener("input", () => {
      firstLoginConfirm.removeAttribute("aria-invalid");
      updateFirstLogin();
    });
    firstLoginDialog?.addEventListener("cancel", (event) =>
      event.preventDefault(),
    );
    $("#first-login-cancel")?.addEventListener("click", async () => {
      await fetch("/api/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      }).catch(() => {});
      firstLoginDialog.close();
      firstLoginForm.reset();
      updateFirstLogin();
      studentNumber.focus();
    });
    firstLoginForm?.addEventListener("submit", async (event) => {
      event.preventDefault();
      firstLoginError.textContent = "";
      const button = $('button[type="submit"]', firstLoginForm);
      const rules = passwordRules(
        firstLoginPassword.value,
        studentNumber.value,
      );
      if (!Object.values(rules).every(Boolean)) {
        firstLoginError.textContent =
          "Meet every password requirement before continuing.";
        shake(firstLoginError);
        firstLoginPassword.focus();
        return;
      }
      if (firstLoginPassword.value !== firstLoginConfirm.value) {
        firstLoginConfirm.setAttribute("aria-invalid", "true");
        firstLoginError.textContent =
          "The confirmation does not match your new password.";
        shake(firstLoginError);
        firstLoginConfirm.focus();
        return;
      }
      if (!$("#first-terms").checked || !$("#first-privacy").checked) {
        firstLoginError.textContent =
          "Please read and accept the terms, and acknowledge the privacy notice.";
        shake(firstLoginError);
        $("#first-terms").focus();
        return;
      }
      setButtonBusy(button, true, "Saving permanent password…");
      try {
        await postJson("/api/complete-first-login", {
          password: firstLoginPassword.value,
          termsAccepted: $("#first-terms").checked,
          privacyAccepted: $("#first-privacy").checked,
          policyVersion: "2026-09-20",
        });
        rememberWelcome(firstName);
        window.location.assign("security.html?onboarding=1");
      } catch (setupError) {
        firstLoginError.textContent = setupError.message;
        shake(firstLoginError);
      } finally {
        setButtonBusy(button, false, "Save password and secure account");
      }
    });
  }

  function showReturnNotice() {
    const notice = $("#login-notice");
    if (!notice) return;
    const params = new URLSearchParams(location.search);
    let reason = null;
    if (params.get("session") === "expired") {
      reason = {
        tone: "warning",
        icon: "!",
        title: "Your session timed out.",
        text: "You were signed out automatically after a period of inactivity. Please sign in again.",
      };
    } else if (params.get("signedOut") === "1") {
      reason = {
        tone: "success",
        icon: "✓",
        title: "You have been signed out.",
        text: "Sign in again whenever you are ready.",
      };
    }
    if (!reason) return;
    $("#login-notice-icon").textContent = reason.icon;
    $("#login-notice-title").textContent = reason.title;
    $("#login-notice-text").textContent = reason.text;
    notice.classList.add(reason.tone);
    notice.classList.remove("hidden");
    history.replaceState({}, "", location.pathname);
  }
})();
