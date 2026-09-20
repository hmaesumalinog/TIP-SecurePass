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

  function passwordRules(value, studentNumber = "") {
    return {
      length: value.length >= 12,
      upper: /[A-Z]/.test(value),
      lower: /[a-z]/.test(value),
      number: /\d/.test(value),
      symbol: /[^A-Za-z0-9]/.test(value),
      student: /^\d{7}$/.test(studentNumber)
        ? !value.includes(studentNumber)
        : !/\d{7}/.test(value),
    };
  }

  $$("[data-toggle-password]").forEach((button) => {
    button.addEventListener("click", () => {
      const input = document.getElementById(button.dataset.togglePassword);
      const revealing = input.type === "password";
      input.type = revealing ? "text" : "password";
      button.setAttribute(
        "aria-label",
        revealing ? "Hide password" : "Show password",
      );
      button.textContent = revealing ? "◌" : "◉";
    });
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
        studentNumber.focus();
        return;
      }
      if (!password.value) {
        password.setAttribute("aria-invalid", "true");
        error.textContent = "Enter your password.";
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
          password.value = "";
          firstLoginDialog.showModal();
          firstLoginPassword.focus();
        } else {
          window.location.assign("portal.html");
        }
      } catch (loginError) {
        error.textContent = loginError.message;
        password.select();
      } finally {
        setButtonBusy(submit, false, "Sign in to student portal");
      }
    });

    firstLoginPassword?.addEventListener("input", () => {
      const rules = passwordRules(
        firstLoginPassword.value,
        studentNumber.value,
      );
      Object.entries(rules).forEach(([name, met]) =>
        $(`[data-first-rule="${name}"]`, firstLoginDialog).classList.toggle(
          "met",
          met,
        ),
      );
      firstLoginError.textContent = "";
    });
    firstLoginConfirm?.addEventListener("input", () => {
      firstLoginConfirm.removeAttribute("aria-invalid");
      firstLoginError.textContent = "";
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
        firstLoginPassword.focus();
        return;
      }
      if (firstLoginPassword.value !== firstLoginConfirm.value) {
        firstLoginConfirm.setAttribute("aria-invalid", "true");
        firstLoginError.textContent =
          "The confirmation does not match your new password.";
        firstLoginConfirm.focus();
        return;
      }
      if (!$("#first-terms").checked || !$("#first-privacy").checked) {
        firstLoginError.textContent =
          "Please read and accept the terms, and acknowledge the privacy notice.";
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
        window.location.assign("security.html?onboarding=1");
      } catch (setupError) {
        firstLoginError.textContent = setupError.message;
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
