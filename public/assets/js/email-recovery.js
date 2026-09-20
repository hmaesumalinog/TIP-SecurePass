import {
  normalizeOtp,
  passwordRules,
  remainingSeconds,
  formatCountdown,
} from "./recovery-utils.mjs";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const page = document.body.dataset.emailPage;
// A very fast response can place the next screen's link under a double-click.
// Ignore only the second pointer click; keyboard activation remains unchanged.
$("#email-flow").addEventListener(
  "click",
  (event) => {
    if (event.detail > 1) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  },
  true,
);
let view = page === "forgot" ? "request" : "loading";
let busy = false,
  alive = true,
  controller;
let emailDeadline = 0,
  emailAddress = "";
let token = "",
  challengeId = "",
  grantToken = "";
let codeDeadline = 0,
  passwordDeadline = 0,
  resendDeadline = 0;
let codeAvailable = false,
  remainingSends = 0,
  attempts = 0,
  polls = 0,
  pollTimer;

function progress(step) {
  $$("#email-progress li").forEach((item, index) => {
    item.classList.toggle("is-complete", index < step);
    if (index === step) item.setAttribute("aria-current", "step");
    else item.removeAttribute("aria-current");
    item.querySelector(".step-number").textContent =
      index < step ? "✓" : String(index + 1);
  });
}
function clearError() {
  $("#flow-error").hidden = true;
  $("#flow-error").textContent = "";
  $$("[aria-invalid]").forEach((input) => {
    input.removeAttribute("aria-invalid");
    input.removeAttribute("aria-errormessage");
  });
}
function errorMessage(message, input) {
  $("#flow-error").textContent = message;
  $("#flow-error").hidden = false;
  if (input) {
    input.setAttribute("aria-invalid", "true");
    input.setAttribute("aria-errormessage", "flow-error");
    input.focus();
  } else $("#flow-error").focus();
}
function show(next, focus = true) {
  view = next;
  clearError();
  $$("[data-view]").forEach((section) => {
    section.hidden = section.dataset.view !== next;
  });
  progress(
    {
      request: 0,
      sent: 1,
      loading: 2,
      otp: 2,
      stopped: 2,
      password: 3,
      complete: 4,
    }[next],
  );
  if (focus) $(`[data-view="${next}"] h2`)?.focus();
  syncControls();
}
async function post(endpoint, body) {
  controller = new AbortController();
  const timeout = setTimeout(() => controller?.abort(), 20000);
  try {
    const response = await fetch(`/api/${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data) {
      const error = new Error(
        data?.message ||
          "We couldn’t confirm the request. Please try again later.",
      );
      error.status = response.status;
      error.uncertain = response.status >= 500 || !data;
      throw error;
    }
    return data;
  } catch (error) {
    if (error.status) throw error;
    const network = new Error(
      "We couldn’t confirm the request. Check your internet connection.",
    );
    network.uncertain = true;
    throw network;
  } finally {
    clearTimeout(timeout);
    controller = null;
  }
}
async function run(button, label, work) {
  if (busy) return;
  busy = true;
  const original = button ? [...button.childNodes] : [];
  if (button) button.textContent = label;
  $("#email-flow").setAttribute("aria-busy", "true");
  syncControls();
  try {
    await work();
  } finally {
    busy = false;
    if (button) button.replaceChildren(...original);
    $("#email-flow").removeAttribute("aria-busy");
    if (alive) {
      syncControls();
      if (!$("#flow-error").hidden) {
        const invalid = $('[aria-invalid="true"]');
        (invalid && !invalid.disabled ? invalid : $("#flow-error")).focus();
      }
    }
  }
}
function syncControls() {
  $$("#email-flow button, #email-flow input").forEach((control) => {
    control.disabled = busy;
  });
  if (page === "forgot") {
    const wait = remainingSeconds(emailDeadline);
    $("#send-email").disabled = busy || wait > 0;
    $("#resend-email").disabled = busy || wait > 0;
    $("#email-wait").textContent = wait
      ? `You can request another email in ${formatCountdown(wait)}.`
      : "You can request another email if you still need it.";
    $("#request-wait").hidden = !wait;
    $("#request-wait").textContent = wait
      ? `Please wait ${formatCountdown(wait)} before sending another request.`
      : "";
  } else {
    const seconds = remainingSeconds(codeDeadline),
      wait = remainingSeconds(resendDeadline);
    $("#otp-code").disabled = busy || !codeAvailable || !seconds;
    $('#otp-form button[type="submit"]').disabled =
      busy || !codeAvailable || !seconds;
    $("#resend-code").disabled = busy || wait > 0 || remainingSends <= 0;
    $("#sms-wait").textContent =
      remainingSends <= 0
        ? "No more texts available for this link. Request a new reset link if needed."
        : wait
          ? `Another code is available in ${formatCountdown(wait)}.`
          : `${remainingSends} new ${remainingSends === 1 ? "code" : "codes"} remaining for this link.`;
    $("#otp-timer").textContent = seconds
      ? formatCountdown(seconds)
      : "Expired";
    $("#password-timer").textContent = formatCountdown(
      remainingSeconds(passwordDeadline),
    );
    $('#password-form button[type="submit"]').disabled =
      busy || !grantToken || !remainingSeconds(passwordDeadline);
  }
}
function stop(title, text, retry = false) {
  clearTimeout(pollTimer);
  codeAvailable = false;
  $("#stopped-title").textContent = title;
  $("#stopped-message").textContent = text;
  $("#retry-reset").hidden = !retry;
  show("stopped");
}

if (page === "forgot") {
  const input = $("#school-email");
  input.addEventListener("input", clearError);
  async function sendEmail(resend) {
    if (busy || remainingSeconds(emailDeadline)) return;
    input.value = input.value.trim();
    if (
      !input.validity.valid ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.value)
    ) {
      errorMessage(
        "Enter the full email address connected to your account, such as student@tip.edu.ph.",
        input,
      );
      return;
    }
    emailAddress = input.value.toLowerCase();
    clearError();
    emailDeadline = Date.now() + 60000;
    await run(
      resend ? $("#resend-email") : $("#send-email"),
      "Sending request…",
      async () => {
        try {
          await post("request-reset", { email: emailAddress });
          if (!alive) return;
          $("#email-destination").textContent = emailAddress;
          $("#email-status").hidden = !resend;
          $("#email-status").textContent =
            "Another request was accepted. If the address matches an account, follow the newest recovery email. Delivery may take a few minutes.";
          show("sent");
        } catch (error) {
          if (!alive) return;
          if (error.status === 429) emailDeadline = Date.now() + 15 * 60000;
          errorMessage(
            error.uncertain
              ? "We couldn’t confirm whether your email request went through. Check your inbox and Spam folder before sending again. Please wait a minute and check your connection."
              : error.message,
          );
        }
      },
    );
  }
  $("#forgot-form").addEventListener("submit", (event) => {
    event.preventDefault();
    sendEmail(false);
  });
  $("#resend-email").addEventListener("click", () => sendEmail(true));
  $("#change-email").addEventListener("click", () => {
    if (!busy) {
      show("request");
      input.focus();
    }
  });
  show("request", false);
} else {
  token = new URLSearchParams(location.search).get("token") || "";
  const code = $("#otp-code"),
    password = $("#new-password"),
    confirmation = $("#confirm-password");
  async function start(resend = false, polling = false) {
    if (busy || !alive) return;
    if (!/^[A-Za-z0-9_-]{32,200}$/.test(token)) {
      stop(
        "This link can’t be used",
        "The link may be incomplete. Request a fresh reset email and open its complete link.",
      );
      return;
    }
    if (resend && (remainingSeconds(resendDeadline) || remainingSends <= 0))
      return;
    clearTimeout(pollTimer);
    if (!polling) {
      polls = 0;
      clearError();
    }
    if (resend) {
      code.value = "";
      codeAvailable = false;
      $("#demo-sms").hidden = true;
    }
    await run(
      resend ? $("#resend-code") : null,
      "Requesting a new code…",
      async () => {
        try {
          const data = await post("start-reset", {
            token,
            resend,
            previousChallengeId: challengeId || null,
          });
          if (!alive) return;
          challengeId = data.challengeId || challengeId;
          resendDeadline =
            Date.now() + Math.max(0, Number(data.retryAfter) || 0) * 1000;
          remainingSends = Math.max(0, Number(data.remainingSends) || 0);
          codeDeadline =
            Date.now() + Math.max(0, Number(data.expiresIn) || 0) * 1000;
          if (data.status === "verified") {
            stop(
              "This phone code was already verified",
              "Continue in the tab where you verified it. If that tab was closed, request a new reset link.",
            );
            return;
          }
          if (["limited", "locked", "invalid"].includes(data.status)) {
            stop(
              "Start with a new reset link",
              "This request expired or reached its verification or sending limit. Request a new email to safely start again.",
            );
            return;
          }
          if (!["active", "pending", "failed", "expired"].includes(data.status))
            throw new Error("Unexpected recovery response");
          $("#masked-phone").textContent =
            data.maskedPhone || "your registered phone";
          codeAvailable =
            (data.status === "active" || data.status === "failed") &&
            data.expiresIn > 0;
          $("#delivery-status").textContent =
            data.status === "active"
              ? data.sent
                ? resend
                  ? "A new text was requested. Use its code; the previous code no longer works."
                  : "Your text was requested. It may take a moment to arrive."
                : "A code is already active. Use the text previously sent for this request."
              : data.status === "pending"
                ? "Your text is being processed. Please keep this page open; there is no need to request another one."
                : data.status === "failed"
                  ? "We couldn’t confirm text delivery. If a code arrives, you can still try it before it expires. Otherwise, use Send a new code when available."
                  : "This code has expired. Use Send a new code below, or request a new reset email.";
          $("#demo-sms").hidden = !data.demoOtp;
          $("#demo-code").textContent = data.demoOtp || "";
          if (data.sent) {
            code.value = "";
            attempts = 0;
          }
          if (view !== "otp") show("otp");
          if (data.status === "pending") {
            // Status-only calls reuse the reserved challenge; they never request a resend.
            if (++polls <= 6)
              pollTimer = setTimeout(() => start(false, true), 2500);
            else
              stop(
                "Your text is taking longer than usual",
                "Delivery has not been confirmed yet. Check this request again without sending another text, or try another recovery method.",
                true,
              );
          }
        } catch (error) {
          if (!alive) return;
          stop(
            error.status === 410 || error.status === 400
              ? "This link can’t be used"
              : "We couldn’t finish checking your link",
            error.status === 410 || error.status === 400
              ? "It may have expired, already been used, or been copied incompletely. Request a fresh email to continue."
              : "Check your connection, then check this request again. This reuses any active phone code rather than automatically sending another text.",
            error.status !== 410 && error.status !== 400,
          );
        }
      },
    );
  }
  $("#retry-reset").addEventListener("click", () => start());
  $("#resend-code").addEventListener("click", () => start(true));
  code.addEventListener("input", () => {
    code.value = normalizeOtp(code.value);
    clearError();
  });
  code.addEventListener("paste", (event) => {
    event.preventDefault();
    code.value = normalizeOtp(event.clipboardData.getData("text"));
    clearError();
  });
  $("#otp-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy || !codeAvailable || !remainingSeconds(codeDeadline)) return;
    if (!/^\d{6}$/.test(code.value)) {
      errorMessage("Enter all six digits from your text message.", code);
      return;
    }
    clearError();
    clearTimeout(pollTimer);
    await run(
      $('#otp-form button[type="submit"]'),
      "Checking your code…",
      async () => {
        try {
          const data = await post("verify-otp", {
            challengeId,
            code: code.value,
          });
          if (!alive) return;
          if (!data.grantToken) throw new Error("No verified session returned");
          grantToken = data.grantToken;
          passwordDeadline =
            Date.now() + (Number(data.expiresIn) || 600) * 1000;
          code.value = "";
          token = "";
          codeAvailable = false;
          history.replaceState({}, "", location.pathname);
          show("password");
        } catch (error) {
          if (!alive) return;
          if (error.status === 400) attempts++;
          if (
            error.status === 410 ||
            error.status === 429 ||
            attempts >= 5 ||
            /too many incorrect/i.test(error.message)
          ) {
            stop(
              "This code is no longer available",
              "The code expired, was already verified, or reached its attempt limit. Request a new reset link to continue.",
            );
          } else
            errorMessage(
              error.uncertain
                ? "We couldn’t confirm verification. Try the same code again if it is still active. If it was already accepted, you may need a fresh reset link."
                : error.message,
              code,
            );
        }
      },
    );
  });
  function updatePassword() {
    const rules = passwordRules(password.value);
    Object.entries(rules).forEach(([rule, met]) =>
      $(`[data-rule="${rule}"]`).classList.toggle("is-valid", met),
    );
    $("#password-match").textContent = !confirmation.value
      ? "Enter the same password again."
      : confirmation.value === password.value
        ? "Passwords match."
        : "The passwords don’t match yet.";
    $("#password-match").classList.toggle(
      "is-valid",
      !!confirmation.value && confirmation.value === password.value,
    );
    clearError();
  }
  password.addEventListener("input", updatePassword);
  confirmation.addEventListener("input", updatePassword);
  $$("[data-reveal]").forEach((button) =>
    button.addEventListener("click", () => {
      const input = document.getElementById(button.dataset.reveal),
        reveal = input.type === "password";
      input.type = reveal ? "text" : "password";
      button.textContent = reveal ? "Hide" : "Show";
      button.setAttribute("aria-pressed", String(reveal));
      button.setAttribute(
        "aria-label",
        `${reveal ? "Hide" : "Show"} ${input.id === "new-password" ? "new" : "confirmed"} password`,
      );
    }),
  );
  $("#password-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy || !grantToken || !remainingSeconds(passwordDeadline)) return;
    if (!Object.values(passwordRules(password.value)).every(Boolean)) {
      errorMessage(
        "Follow each password requirement before continuing.",
        password,
      );
      return;
    }
    if (confirmation.value !== password.value) {
      errorMessage("Enter the same new password in both fields.", confirmation);
      return;
    }
    clearError();
    await run(
      $('#password-form button[type="submit"]'),
      "Saving your password…",
      async () => {
        try {
          const data = await post("complete-reset", {
            grantToken,
            password: password.value,
          });
          if (!alive) return;
          grantToken = "";
          password.value = "";
          confirmation.value = "";
          code.value = "";
          $("#notice-status").textContent =
            data.noticeSent === false
              ? "Your password was saved, but the confirmation email could not be sent. You can still sign in."
              : "A security confirmation email was submitted for delivery. You don’t need to wait for it to sign in.";
          show("complete");
        } catch (error) {
          if (!alive) return;
          if (error.uncertain || $("#uncertain-save").hidden === false) {
            $("#uncertain-save").hidden = false;
            errorMessage(
              "We couldn’t confirm the save. It may already have completed. Try signing in with your new password before starting again.",
            );
          } else if (error.status === 410) {
            grantToken = "";
            password.value = "";
            confirmation.value = "";
            stop(
              "Your verified request has expired",
              "For your safety, verification lasts ten minutes. Request a new reset link to continue.",
            );
          } else errorMessage(error.message);
        }
      },
    );
  });
  start();
}
$("#email-flow").addEventListener("click", (event) => {
  if (busy && event.target.closest("a")) event.preventDefault();
});
const clock = setInterval(() => {
  if (!alive) return;
  if (page === "reset" && !busy) {
    if (view === "otp" && codeAvailable && !remainingSeconds(codeDeadline)) {
      codeAvailable = false;
      $("#delivery-status").textContent =
        "Your code expired. Request another code below, or start with a new reset email.";
    }
    if (
      view === "password" &&
      grantToken &&
      !remainingSeconds(passwordDeadline)
    ) {
      grantToken = "";
      $("#new-password").value = "";
      $("#confirm-password").value = "";
      stop(
        "Your verified request has expired",
        "For your safety, verification lasts ten minutes. Request a fresh reset link to continue.",
      );
    }
  }
  syncControls();
}, 1000);
window.addEventListener("beforeunload", (event) => {
  if (busy || grantToken) {
    event.preventDefault();
    event.returnValue = "";
  }
});
window.addEventListener("pagehide", () => {
  alive = false;
  controller?.abort();
  clearTimeout(pollTimer);
  clearInterval(clock);
  token = "";
  grantToken = "";
  challengeId = "";
  emailAddress = "";
  $$("input").forEach((input) => {
    input.value = "";
  });
});
window.addEventListener("pageshow", (event) => {
  if (event.persisted) location.reload();
});
