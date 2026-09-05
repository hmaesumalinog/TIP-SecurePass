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
      if (submit.disabled) return;
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
        startEmailCooldown();
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
    let emailTimer;
    function startEmailCooldown() {
      clearTimeout(emailTimer);
      const deadline = Date.now() + 60000;
      const tick = () => {
        const seconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
        $("#resend-email").disabled = seconds > 0;
        $("#resend-email").textContent = seconds
          ? "Resend email in " + seconds + " seconds"
          : "Resend email";
        if (seconds) emailTimer = setTimeout(tick, 1000);
      };
      tick();
    }
    $("#resend-email").addEventListener("click", async () => {
      const button = $("#resend-email");
      if (button.disabled) return;
      button.disabled = true;
      try {
        await postJson("/api/request-reset", { email: email.value.trim() });
        $("#email-status").textContent =
          "If this email matches an account, another link is on its way. Open the newest message.";
      } catch (error) {
        $("#email-status").textContent = error.message;
      } finally {
        startEmailCooldown();
      }
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
        "recovery-error-view",
        "invalid-view",
        "otp-view",
        "password-view",
        "complete-view",
      ].forEach((id) => {
        document.getElementById(id).classList.toggle("hidden", id !== view);
      });
    };

    let requestBusy = false;
    let timerId;
    let pollId;
    let resendAt = 0;
    let remainingSends = 3;
    const codeInput = $("#otp-1");
    const otpInputs = [codeInput];
    const resendButton = $("#resend-code");
    const statusText = $("#delivery-status");
    const recoveryError = (title, message) => {
      $("#recovery-error-title").textContent = title;
      $("#recovery-error-message").textContent = message;
      show("recovery-error-view");
    };
    async function start(resend = false) {
      if (requestBusy) return;
      if (preview) {
        state.challengeId = "preview-challenge";
        $("#masked-phone").textContent = "+63 ••• ••• 4821";
        $("#demo-otp-code").textContent = "482106";
        $("#demo-sms").classList.remove("hidden");
        show("otp-view");
        startTimer();
        return;
      }
      if (!rawToken) {
        show("invalid-view");
        return;
      }
      requestBusy = true;
      resendButton.disabled = true;
      clearTimeout(pollId);
      try {
        const data = await postJson("/api/start-reset", {
          token: rawToken,
          resend,
          previousChallengeId: state.challengeId || null,
        });
        state.challengeId = data.challengeId || state.challengeId;
        resendAt = Date.now() + (data.retryAfter || 0) * 1000;
        remainingSends = data.remainingSends || 0;
        $("#masked-phone").textContent =
          data.maskedPhone || "your registered phone";
        if (data.status === "verified") {
          recoveryError(
            "Your phone is already verified",
            "Continue in the tab where you verified your code. If that tab was closed, request a new reset link.",
          );
          return;
        }
        if (data.status === "limited" || data.status === "locked") {
          recoveryError(
            "Request a new reset link",
            "This recovery attempt reached its code or verification limit.",
          );
          return;
        }
        show("otp-view");
        $("#otp-form").classList.remove("hidden");
        $("#otp-expired").classList.add("hidden");
        $("#otp-view .form-intro").classList.remove("hidden");
        $("#otp-error").textContent = "";
        if (data.status === "active") {
          $("#otp-view h2").textContent = "Enter your phone code";
          codeInput.disabled = false;
          $('button[type="submit"]', $("#otp-form")).disabled = false;
          if (data.sent) codeInput.value = "";
          statusText.textContent = data.sent
            ? resend
              ? "A new code was sent. Use the newest SMS."
              : "Your code was sent. It may take a moment to arrive."
            : "Your code is still active. Use the SMS already sent to your phone.";
          if (data.demoOtp) {
            $("#demo-otp-code").textContent = data.demoOtp;
            $("#demo-sms").classList.remove("hidden");
          }
          startTimer(data.expiresIn);
        } else {
          const canEnterDelayedCode =
            data.status === "failed" && data.expiresIn > 0;
          codeInput.disabled = !canEnterDelayedCode;
          $('button[type="submit"]', $("#otp-form")).disabled =
            !canEnterDelayedCode;
          $("#otp-view .form-intro").classList.add("hidden");
          $("#otp-view h2").textContent =
            data.status === "pending"
              ? "Sending your phone code"
              : "Request another code";
          statusText.textContent =
            data.status === "pending"
              ? "Your code is being sent. Please wait; there is no need to reopen the link."
              : data.status === "expired"
                ? "Your code expired. Request a new code below."
                : "We could not confirm SMS delivery. If a code arrives, you can enter it here. Otherwise, try resending.";
          if (!remainingSends && data.status !== "pending") {
            statusText.textContent +=
              " The send limit is reached; request a new reset link if needed.";
          }
          startTimer(canEnterDelayedCode ? data.expiresIn : 0);
          if (data.status === "pending")
            pollId = setTimeout(() => start(), 2500);
        }
      } catch (error) {
        if (error.status === 410 || error.status === 400) show("invalid-view");
        else recoveryError("We couldn’t continue yet", error.message);
      } finally {
        requestBusy = false;
        updateResend();
      }
    }
    function updateResend() {
      const seconds = Math.max(0, Math.ceil((resendAt - Date.now()) / 1000));
      resendButton.disabled = requestBusy || seconds > 0 || remainingSends <= 0;
      resendButton.textContent =
        remainingSends <= 0
          ? "Code limit reached"
          : seconds
            ? "Resend available in " + seconds + " seconds"
            : "Resend code";
    }
    resendButton.addEventListener("click", () => start(true));
    $("#retry-reset").addEventListener("click", () => start());
    codeInput.addEventListener("input", () => {
      codeInput.value = codeInput.value.replace(/\\D/g, "").slice(0, 6);
      $("#otp-error").textContent = "";
    });
    codeInput.addEventListener("paste", (event) => {
      event.preventDefault();
      codeInput.value = event.clipboardData
        .getData("text")
        .replace(/\\D/g, "")
        .slice(0, 6);
    });

    $("#otp-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const code = codeInput.value;
      const error = $("#otp-error");
      const button = $('button[type="submit"]', event.currentTarget);
      if (button.disabled) return;
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
        clearTimeout(timerId);
        clearTimeout(pollId);
        startPasswordTimer();
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
      if (button.disabled) return;
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
        clearTimeout(timerId);
        $("#password-step").classList.remove("active");
        $("#password-step").classList.add("done");
        $("#password-step .step-dot").textContent = "✓";
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
      clearTimeout(timerId);
      const deadline = Date.now() + seconds * 1000;
      const tick = () => {
        const remaining = Math.max(
          0,
          Math.ceil((deadline - Date.now()) / 1000),
        );
        $("#otp-timer").textContent = remaining
          ? Math.floor(remaining / 60)
              .toString()
              .padStart(2, "0") +
            ":" +
            (remaining % 60).toString().padStart(2, "0")
          : "Expired";
        if (!remaining && !codeInput.disabled) {
          codeInput.disabled = true;
          $('button[type="submit"]', $("#otp-form")).disabled = true;
          statusText.textContent =
            "Your code expired. Request another code below.";
        }
        updateResend();
        timerId = setTimeout(tick, 1000);
      };
      tick();
    }
    function startPasswordTimer() {
      const deadline = Date.now() + 600000;
      const tick = () => {
        const seconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
        $("#password-time").textContent =
          "Finish within " + Math.ceil(seconds / 60) + " minutes.";
        if (!seconds) {
          recoveryError(
            "Your verification session expired",
            "Request a new reset link to continue securely.",
          );
          return;
        }
        timerId = setTimeout(tick, 1000);
      };
      tick();
    }
    const matchHint = $("#password-match");
    const updateMatch = () => {
      matchHint.textContent = !confirmPassword.value
        ? ""
        : newPassword.value === confirmPassword.value
          ? "Passwords match."
          : "Passwords do not match yet.";
    };
    confirmPassword.addEventListener("input", updateMatch);
    newPassword.addEventListener("input", updateMatch);

    start();
  }
})();
