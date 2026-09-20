import {
  normalizeBackupCode,
  validBackupCode,
  normalizeOtp,
  passwordRules,
  remainingSeconds,
  formatCountdown,
} from "./recovery-utils.mjs";

const $ = (selector) => document.querySelector(selector);
const endpoint = "/.netlify/functions/alternate-recovery";
const isRecovery = document.body.dataset.recoveryPage === "recover";
let token = "",
  method = "",
  view = "choose",
  deadline = 0,
  cooldown = 0,
  busy = false,
  consumed = false,
  uncertainSave = false,
  failures = 0;
let requestGeneration = 0,
  activeRequest = null;

function clearMessage() {
  $("#sr-message").hidden = true;
  document.querySelectorAll('[aria-invalid="true"]').forEach((field) => {
    field.removeAttribute("aria-invalid");
    field.removeAttribute("aria-errormessage");
  });
}
function message(text, field) {
  const node = $("#sr-message");
  node.textContent = text;
  node.hidden = false;
  if (field) {
    field.setAttribute("aria-invalid", "true");
    field.setAttribute("aria-errormessage", "sr-message");
  }
  node.focus();
  node.scrollIntoView({ block: "nearest" });
}
function show(next) {
  clearMessage();
  view = next;
  document
    .querySelectorAll("[data-view]")
    .forEach((section) => (section.hidden = section.dataset.view !== next));
  const index = {
    choose: 0,
    details: 1,
    verify: 2,
    password: 3,
    success: 4,
    stopped: consumed ? 3 : 2,
  }[next];
  document
    .querySelectorAll("#recovery-progress li")
    .forEach((item, position) => {
      item.classList.toggle("is-complete", position < index);
      item.querySelector(".step-number").textContent =
        position < index ? "✓" : String(position + 1);
      if (position === index) item.setAttribute("aria-current", "step");
      else item.removeAttribute("aria-current");
    });
  $("#recovery-support").hidden = next === "success";
  const heading = $(`[data-view="${next}"] h2`);
  heading.focus();
  heading.scrollIntoView({ block: "nearest" });
  updateTimers();
}
function resetReveals() {
  document.querySelectorAll("[data-reveal]").forEach((button) => {
    document.getElementById(button.dataset.reveal).type = "password";
    button.textContent = "Show";
    button.setAttribute("aria-pressed", "false");
    button.setAttribute(
      "aria-label",
      button.getAttribute("aria-label").replace(/^Hide/, "Show"),
    );
  });
}
function clearProofs() {
  for (const id of [
    "backup-code",
    "recovery-otp",
    "new-password",
    "confirm-password",
  ]) {
    const input = document.getElementById(id);
    if (input) input.value = "";
  }
  resetReveals();
  if (isRecovery) updatePassword();
}
function resetRequest() {
  token = "";
  deadline = 0;
  consumed = false;
  uncertainSave = false;
  failures = 0;
  clearProofs();
  $("#uncertain-save").hidden = true;
  show(method ? "details" : "choose");
}
function stop(title, text) {
  deadline = 0;
  token = "";
  clearProofs();
  $("#restart-dialog").close();
  $("#stopped-title").textContent = title;
  $("#stopped-message").textContent = text;
  show("stopped");
}
function updateTimers() {
  if (!isRecovery) return;
  const wait = remainingSeconds(cooldown);
  $("#start-submit").disabled = busy || wait > 0;
  $("#start-cooldown").hidden = wait === 0;
  $("#start-cooldown").textContent = wait
    ? `Wait ${formatCountdown(wait)} before starting another request. This helps prevent duplicate texts.`
    : "";
  document.querySelectorAll("[data-restart]").forEach((button) => {
    button.disabled = busy || (!consumed && wait > 0);
    if (!button.dataset.label) button.dataset.label = button.textContent;
    button.textContent =
      !consumed && wait > 0
        ? `Start again in ${formatCountdown(wait)}`
        : button.dataset.label;
  });
  if (!deadline || busy) return;
  const seconds = remainingSeconds(deadline);
  document.querySelectorAll("[data-countdown]").forEach((node) => {
    node.textContent = formatCountdown(seconds);
    node.classList.toggle("is-low", seconds <= 60);
  });
  if (seconds === 0 && ["verify", "password"].includes(view)) {
    stop(
      "This request has expired",
      uncertainSave
        ? "We couldn’t confirm the earlier password save. Try signing in with that password first. If you need another recovery request, use a different unused backup code."
        : consumed
          ? "Your verified session has ended. The backup code you verified was already used, so you’ll need a different unused backup code to start again. Your password was not changed in this step."
          : "The five-minute verification window has ended. Start again with an unused backup code when you’re ready. You can reuse this code if verification never succeeded.",
    );
  }
}
async function api(data) {
  const controller = new AbortController();
  const generation = requestGeneration;
  activeRequest = controller;
  const timeout = window.setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
      cache: "no-store",
      signal: controller.signal,
    });
    const result = await response.json();
    if (generation !== requestGeneration) {
      const error = new Error(
        "This page has moved to a different recovery flow.",
      );
      error.abandoned = true;
      throw error;
    }
    if (!response.ok) {
      const error = new Error(
        result.message ||
          "We couldn’t complete this request. Please try again.",
      );
      error.status = response.status;
      throw error;
    }
    return result;
  } catch (error) {
    if (generation !== requestGeneration) error.abandoned = true;
    if (!error.status) error.network = true;
    throw error;
  } finally {
    window.clearTimeout(timeout);
    if (activeRequest === controller) activeRequest = null;
  }
}
async function run(form, label, task) {
  if (busy) return;
  busy = true;
  clearMessage();
  const submit = form.querySelector('[type="submit"]'),
    original = [...submit.childNodes];
  const controls = [
    ...document.querySelectorAll("button, input, textarea"),
  ].map((element) => [element, element.disabled]);
  controls.forEach(([element]) => (element.disabled = true));
  submit.textContent = label;
  form.setAttribute("aria-busy", "true");
  try {
    await task();
  } catch (error) {
    if (error.abandoned) return;
    if (
      form.id === "alternate-complete" &&
      (error.network || error.status >= 500)
    ) {
      uncertainSave = true;
      $("#uncertain-save").hidden = false;
      message(
        "We couldn’t confirm whether your password was saved. Try signing in with the new password before starting again.",
      );
    } else if (error.network) {
      message(
        form.id === "help-form"
          ? "We couldn’t confirm your submission. It may have reached the administrator. Wait before sending the same request again."
          : form.id === "alternate-start"
            ? "We couldn’t confirm this request. A text may still arrive, but it cannot be used without an active verification step. Wait a minute before checking your details and trying again."
            : "We couldn’t confirm verification. Keep this page open and try again when your connection is stable. If you restart, use another backup code in case verification already succeeded.",
      );
    } else if (form.id === "alternate-verify" && error.status === 400) {
      failures++;
      if (failures >= 5)
        stop(
          "We couldn’t verify this request",
          "For your protection, this request can’t accept more attempts. Start again with an unused backup code, or ask the administrator for help. Check that you’re using a method you previously set up.",
        );
      else
        message(
          "That combination couldn’t be verified. Check the six-digit code and the recovery details you entered. An expired request, used backup code, or unavailable method can also cause this. Nothing is automatically retried.",
          $("#recovery-otp"),
        );
    } else message(error.message);
  } finally {
    busy = false;
    controls.forEach(([element, disabled]) => (element.disabled = disabled));
    submit.replaceChildren(...original);
    form.removeAttribute("aria-busy");
    updateTimers();
  }
}
function onForm(id, handle) {
  const form = document.getElementById(id);
  if (form)
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!busy) handle(form);
    });
}
document.querySelectorAll("[data-reveal]").forEach((button) =>
  button.addEventListener("click", () => {
    const input = document.getElementById(button.dataset.reveal),
      revealed = input.type === "password";
    input.type = revealed ? "text" : "password";
    button.textContent = revealed ? "Hide" : "Show";
    button.setAttribute("aria-pressed", String(revealed));
    button.setAttribute(
      "aria-label",
      button
        .getAttribute("aria-label")
        .replace(/^(Show|Hide)/, revealed ? "Hide" : "Show"),
    );
  }),
);
document
  .querySelectorAll('[name="studentNumber"]')
  .forEach((input) =>
    input.addEventListener(
      "input",
      () => (input.value = input.value.replace(/\D/g, "").slice(0, 7)),
    ),
  );
document.addEventListener("click", (event) => {
  if (busy && event.target.closest("a")) event.preventDefault();
});

function updatePassword() {
  const password = $("#new-password").value,
    confirmation = $("#confirm-password").value;
  const rules = passwordRules(password);
  document
    .querySelectorAll("[data-rule]")
    .forEach((item) =>
      item.classList.toggle("is-valid", !!password && rules[item.dataset.rule]),
    );
  const matches = !!confirmation && confirmation === password;
  $("#password-match").textContent = matches
    ? "Passwords match."
    : confirmation
      ? "The passwords don’t match yet."
      : "Enter the same password again.";
  $("#password-match").classList.toggle("is-valid", matches);
}
if (isRecovery) {
  document.querySelectorAll("[data-method]").forEach((button) =>
    button.addEventListener("click", () => {
      method = button.dataset.method;
      $("#chosen-method-name").textContent =
        method === "sms" ? "Text message (SMS)" : "Authenticator app";
      clearProofs();
      show("details");
    }),
  );
  $("#change-method").addEventListener("click", () => {
    clearProofs();
    show("choose");
  });
  $("#recovery-otp").addEventListener(
    "input",
    (event) => (event.target.value = normalizeOtp(event.target.value)),
  );
  for (const id of ["new-password", "confirm-password"])
    document.getElementById(id).addEventListener("input", updatePassword);
  document.querySelectorAll("[data-restart]").forEach((button) =>
    button.addEventListener("click", () => {
      if (busy || (!consumed && remainingSeconds(cooldown))) return;
      $("#restart-description").textContent = uncertainSave
        ? "The previous save may have completed. Try signing in with the new password first. Starting again requires a different unused backup code."
        : consumed
          ? "The backup code you verified has already been used. You’ll need a different unused code. Your other recovery methods will stay connected."
          : "You’ll enter your recovery details again. Use an unused backup code; if verification already succeeded, that code cannot be reused. A text from this request won’t work in the new request.";
      $("#restart-dialog").showModal();
    }),
  );
  $("#keep-request").addEventListener("click", () =>
    $("#restart-dialog").close(),
  );
  $("#confirm-restart").addEventListener("click", () => {
    $("#restart-dialog").close();
    resetRequest();
  });
  onForm("alternate-start", (form) => {
    const number = $("#student-number").value,
      backupCode = normalizeBackupCode($("#backup-code").value);
    if (!/^\d{7}$/.test(number))
      return message(
        "Enter the seven-digit student number you use to sign in.",
        $("#student-number"),
      );
    if (!validBackupCode(backupCode))
      return message(
        "Enter one complete saved backup code: 8 groups of 4 letters or numbers. This is not the six-digit app or SMS code.",
        $("#backup-code"),
      );
    if (!method || remainingSeconds(cooldown)) return;
    run(
      form,
      method === "sms"
        ? "Requesting your text code…"
        : "Preparing verification…",
      async () => {
        const started = Date.now();
        cooldown = started + 60000;
        const result = await api({
          action: "start",
          studentNumber: number,
          backupCode,
          method,
        });
        if (!/^[A-Za-z0-9_-]{43}$/.test(result.token || ""))
          throw new Error(
            "The service did not return a valid recovery request. Wait a minute before trying again.",
          );
        token = result.token;
        deadline = started + 300000;
        failures = 0;
        consumed = false;
        $("#backup-code").value = "";
        resetReveals();
        $("#verify-title").textContent =
          method === "sms"
            ? "Check your text messages"
            : "Open your authenticator app";
        $("#verification-help").textContent =
          method === "sms"
            ? "If your details match an eligible account, a code will be sent to the phone you verified earlier."
            : "Use the authenticator you connected to this portal before you lost access. No email or text message is needed.";
        $("#otp-label").textContent =
          method === "sms"
            ? "Six-digit code from your text message"
            : "Six-digit authenticator code";
        $("#authenticator-guide").hidden = method === "sms";
        $("#authenticator-trouble").hidden = method === "sms";
        $("#sms-guide").hidden = method !== "sms";
        $("#sms-trouble").hidden = method !== "sms";
        $("#verification-trouble-title").textContent =
          method === "sms"
            ? "Text not arriving or code not working?"
            : "Authenticator code not working?";
        show("verify");
      },
    );
  });
  onForm("alternate-verify", (form) => {
    const code = $("#recovery-otp").value;
    if (!/^\d{6}$/.test(code))
      return message(
        "Enter all six digits from your chosen recovery method.",
        $("#recovery-otp"),
      );
    if (!token || !remainingSeconds(deadline)) return updateTimers();
    run(form, "Verifying your code…", async () => {
      const started = Date.now();
      await api({ action: "verify", token, code });
      consumed = true;
      deadline = started + 600000;
      $("#recovery-otp").value = "";
      show("password");
    });
  });
  onForm("alternate-complete", (form) => {
    const password = $("#new-password").value;
    if (!Object.values(passwordRules(password)).every(Boolean))
      return message(
        "Your password needs to meet every requirement listed below.",
        $("#new-password"),
      );
    if (password !== $("#confirm-password").value)
      return message(
        "The passwords don’t match. Enter the same password in both fields.",
        $("#confirm-password"),
      );
    if (!token || !remainingSeconds(deadline)) return updateTimers();
    run(form, "Saving your new password…", async () => {
      const result = await api({ action: "complete", token, password });
      token = "";
      deadline = 0;
      uncertainSave = false;
      clearProofs();
      $("#notice-warning").hidden = result.noticeSent !== false;
      show("success");
    });
  });
  window.setInterval(updateTimers, 1000);
  document.addEventListener("visibilitychange", updateTimers);
  window.addEventListener("focus", updateTimers);
  // Recovery proofs stay in memory. Navigating away requires a fresh request.
  window.addEventListener("beforeunload", (event) => {
    if (token || busy) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  window.addEventListener("pagehide", () => {
    requestGeneration++;
    activeRequest?.abort();
    token = "";
    deadline = 0;
    clearProofs();
  });
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) resetRequest();
  });
} else {
  onForm("help-form", (form) => {
    const number = $("#help-number").value,
      contact = $("#help-contact").value.trim(),
      explanation = $("#help-message").value.trim();
    if (!/^\d{7}$/.test(number))
      return message(
        "Enter your seven-digit student number.",
        $("#help-number"),
      );
    if (contact.length < 5 || contact.length > 254)
      return message(
        "Provide a reachable email address or phone number (5–254 characters).",
        $("#help-contact"),
      );
    if (explanation.length < 10 || explanation.length > 1000)
      return message(
        "Briefly explain what you cannot access (10–1,000 characters). Don’t include any passwords or codes.",
        $("#help-message"),
      );
    run(form, "Sending your request…", async () => {
      await api({
        action: "help",
        studentNumber: number,
        contact,
        message: explanation,
      });
      form.reset();
      form.hidden = true;
      $("#help-success").hidden = false;
      $("#help-success h2").focus();
      $("#help-success").scrollIntoView({ block: "nearest" });
    });
  });
}
