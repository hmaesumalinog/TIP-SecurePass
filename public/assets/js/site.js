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
    if (!response.ok)
      throw new Error(
        data.message || "We could not complete that request. Please try again.",
      );
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
      setButtonBusy(button, true, "Saving permanent password…");
      try {
        await postJson("/api/complete-first-login", {
          password: firstLoginPassword.value,
        });
        window.location.assign("portal.html");
      } catch (setupError) {
        firstLoginError.textContent = setupError.message;
      } finally {
        setButtonBusy(button, false, "Save password and open portal");
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

  if (page === "forgot") initForgot();
  if (page === "reset") initReset();

  function initForgot() {
    const form = $("#forgot-form");
    const email = $("#school-email");
    const error = $("#forgot-error");
    const submit = $('button[type="submit"]', form);

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      error.textContent = "";
      email.removeAttribute("aria-invalid");
      if (!email.validity.valid) {
        email.setAttribute("aria-invalid", "true");
        error.textContent =
          "Enter a valid school email address, such as student@tip.edu.ph.";
        email.focus();
        return;
      }

      setButtonBusy(submit, true, "Sending securely…");
      try {
        await postJson("/api/request-reset", { email: email.value.trim() });
        $("#request-view").classList.add("hidden");
        $("#sent-view").classList.remove("hidden");
        $("#sent-view").focus();
      } catch (requestError) {
        error.textContent = requestError.message;
      } finally {
        setButtonBusy(submit, false, "Send secure reset link");
      }
    });

    $("#send-again").addEventListener("click", () => {
      $("#sent-view").classList.add("hidden");
      $("#request-view").classList.remove("hidden");
      email.focus();
    });
  }

  function initReset() {
    const params = new URLSearchParams(location.search);
    const rawToken = params.get("token");
    const preview = params.get("preview") === "1";
    const state = { challengeId: "", grantToken: "", preview };

    const show = (view) => {
      [
        "loading-view",
        "invalid-view",
        "otp-view",
        "password-view",
        "complete-view",
      ].forEach((id) => {
        document.getElementById(id).classList.toggle("hidden", id !== view);
      });
    };

    async function start() {
      if (preview) {
        state.challengeId = "preview-challenge";
        $("#masked-phone").textContent = "+63 ••• ••• 4821";
        $("#demo-otp-code").textContent = "482106";
        $("#demo-sms").classList.remove("hidden");
        show("otp-view");
        $("#otp-1").focus();
        startTimer();
        return;
      }
      if (!rawToken) {
        show("invalid-view");
        return;
      }
      try {
        const data = await postJson("/api/start-reset", { token: rawToken });
        state.challengeId = data.challengeId;
        $("#masked-phone").textContent =
          data.maskedPhone || "your registered phone";
        if (data.demoOtp) {
          $("#demo-otp-code").textContent = data.demoOtp;
          $("#demo-sms").classList.remove("hidden");
        }
        show("otp-view");
        $("#otp-1").focus();
        startTimer(data.expiresIn || 300);
      } catch (_) {
        show("invalid-view");
      }
    }

    const otpInputs = $$("#otp-grid input");
    otpInputs.forEach((input, index) => {
      input.addEventListener("input", () => {
        input.value = input.value.replace(/\D/g, "").slice(-1);
        if (input.value && otpInputs[index + 1]) otpInputs[index + 1].focus();
      });
      input.addEventListener("keydown", (event) => {
        if (event.key === "Backspace" && !input.value && otpInputs[index - 1])
          otpInputs[index - 1].focus();
      });
      input.addEventListener("paste", (event) => {
        const digits = event.clipboardData
          .getData("text")
          .replace(/\D/g, "")
          .slice(0, 6);
        if (digits.length === 6) {
          event.preventDefault();
          digits.split("").forEach((digit, digitIndex) => {
            otpInputs[digitIndex].value = digit;
          });
          otpInputs[5].focus();
        }
      });
    });

    $("#otp-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const code = otpInputs.map((input) => input.value).join("");
      const error = $("#otp-error");
      const button = $('button[type="submit"]', event.currentTarget);
      error.textContent = "";
      if (code.length !== 6) {
        error.textContent = "Enter all 6 digits from the phone message.";
        otpInputs[0].focus();
        return;
      }
      setButtonBusy(button, true, "Verifying…");
      try {
        if (preview) {
          if (code !== "482106")
            throw new Error(
              "That code is not correct. For this preview, use 482106.",
            );
          state.grantToken = "preview-grant";
        } else {
          const data = await postJson("/api/verify-otp", {
            challengeId: state.challengeId,
            code,
          });
          state.grantToken = data.grantToken;
        }
        $("#otp-step").classList.remove("active");
        $("#otp-step").classList.add("done");
        $("#otp-step .step-dot").textContent = "✓";
        $("#password-step").classList.add("active");
        show("password-view");
        $("#new-password").focus();
      } catch (verifyError) {
        error.textContent = verifyError.message;
      } finally {
        setButtonBusy(button, false, "Verify code");
      }
    });

    const newPassword = $("#new-password");
    const confirmPassword = $("#confirm-password");
    newPassword.addEventListener("input", () =>
      updateStrength(newPassword.value),
    );

    $("#password-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const error = $("#password-error");
      const button = $('button[type="submit"]', event.currentTarget);
      error.textContent = "";
      const rules = passwordRules(newPassword.value);
      if (!Object.values(rules).every(Boolean)) {
        error.textContent =
          "Meet every password requirement before continuing.";
        newPassword.focus();
        return;
      }
      if (newPassword.value !== confirmPassword.value) {
        confirmPassword.setAttribute("aria-invalid", "true");
        error.textContent =
          "The confirmation does not match your new password.";
        confirmPassword.focus();
        return;
      }
      confirmPassword.removeAttribute("aria-invalid");
      setButtonBusy(button, true, "Updating securely…");
      try {
        if (!preview)
          await postJson("/api/complete-reset", {
            grantToken: state.grantToken,
            password: newPassword.value,
          });
        show("complete-view");
        $("#complete-view").focus();
        history.replaceState({}, "", "reset.html?complete=1");
      } catch (resetError) {
        error.textContent = resetError.message;
      } finally {
        setButtonBusy(button, false, "Update password securely");
      }
    });

    function updateStrength(value) {
      const rules = passwordRules(value);
      Object.entries(rules).forEach(([name, met]) =>
        $(`[data-rule="${name}"]`).classList.toggle("met", met),
      );
      const count = Object.values(rules).filter(Boolean).length;
      const score =
        value.length === 0
          ? 0
          : count <= 2
            ? 1
            : count <= 4
              ? 2
              : count === 5
                ? 3
                : 4;
      const labels = ["Start typing", "Weak", "Fair", "Good", "Strong"];
      $("#strength").dataset.score = String(score);
      $("#strength-label").textContent = labels[score];
    }

    function startTimer(seconds = 300) {
      const timer = $("#otp-timer");
      // Track a deadline rather than counting down a variable: background tabs
      // throttle timers, so a decrementing counter drifts away from real time.
      const deadline = Date.now() + seconds * 1000;
      const tick = () => {
        const remaining = Math.max(
          0,
          Math.round((deadline - Date.now()) / 1000),
        );
        if (remaining === 0) {
          timer.textContent = "Expired";
          expireChallenge();
          return;
        }
        const minutes = Math.floor(remaining / 60)
          .toString()
          .padStart(2, "0");
        const remainder = (remaining % 60).toString().padStart(2, "0");
        timer.textContent = `${minutes}:${remainder}`;
        window.setTimeout(tick, 1000);
      };
      tick();
    }

    function expireChallenge() {
      otpInputs.forEach((input) => {
        input.value = "";
        input.disabled = true;
      });
      // The heading and intro still promise a live code; correct them so the
      // view does not contradict the expiry notice.
      $("#otp-view h2").textContent = "Your code expired";
      $("#otp-view .form-intro").classList.add("hidden");
      $("#otp-form").classList.add("hidden");
      $("#otp-expired").classList.remove("hidden");
      $("#otp-expired").focus();
    }

    start();
  }
})();
