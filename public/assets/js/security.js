/* Student recovery settings: one task per form; proofs live only in memory. */
(() => {
  "use strict";
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const endpoint = "/.netlify/functions/security-settings";
  let status = null,
    password = "",
    codes = "",
    pendingSetup = false;
  let busy = false,
    mode = "setup",
    codeSource = "setup",
    setupUntil = 0,
    smsUntil = 0;
  let phoneNumber = "",
    phoneProof = "",
    phoneDestination = "";
  let deliveryReceipt = "",
    deliveryStatus = "unknown",
    deliveryIssue = "",
    deliveryTimer = 0,
    deliveryGeneration = 0,
    deliveryChecks = 0,
    deliveryBusy = false;

  function stopDeliveryChecks() {
    clearTimeout(deliveryTimer);
    deliveryGeneration++;
    deliveryReceipt = "";
    deliveryIssue = "";
    deliveryChecks = 0;
    deliveryBusy = false;
  }
  function showDelivery(value, issue = "") {
    deliveryStatus = value;
    deliveryIssue =
      value === "failed" && issue === "content_rejected" ? issue : "";
    const messages = {
      pending:
        "SMS queued. The provider is still processing it. You do not need to send another code.",
      sent: "The SMS provider reports that your code was sent. Check your phone; mobile-network delivery can still take a moment.",
      failed:
        "The SMS provider could not send this code. Your phone number has not changed. Wait before trying again; if it fails again, contact the portal administrator.",
      unknown:
        "We could not confirm the SMS status. If a code arrives, you can still enter it. Check your messages before requesting another.",
    };
    $("#sms-delivery").textContent = deliveryIssue
      ? "The SMS service rejected the verification message before sending it. This is a service issue, not a problem with the code you entered. Your phone number has not changed. Please contact the portal administrator; your authenticator and saved backup codes are still available."
      : messages[value] || messages.unknown;
    $("#sms-delivery").hidden = false;
    $("#sms-delivery").classList.toggle("form-error", value === "failed");
    updateTimers();
  }
  async function checkDelivery() {
    if (
      !deliveryReceipt ||
      deliveryBusy ||
      busy ||
      deliveryChecks >= 10 ||
      ["sent", "failed"].includes(deliveryStatus)
    )
      return;
    clearTimeout(deliveryTimer);
    const generation = deliveryGeneration;
    deliveryBusy = true;
    deliveryChecks++;
    updateTimers();
    try {
      const result = await api({
        action: "phone_status",
        receipt: deliveryReceipt,
      });
      if (generation !== deliveryGeneration) return;
      showDelivery(result.deliveryStatus || "unknown", result.deliveryIssue);
    } catch (error) {
      if (generation !== deliveryGeneration) return;
      showDelivery("unknown");
      if ([410, 429].includes(error.status)) deliveryReceipt = "";
    } finally {
      if (generation === deliveryGeneration) {
        deliveryBusy = false;
        updateTimers();
        // At most three automatic read-only checks. Never send another SMS here.
        if (
          deliveryReceipt &&
          deliveryStatus === "pending" &&
          deliveryChecks < 3
        )
          deliveryTimer = setTimeout(checkDelivery, 7000);
      }
    }
  }

  function notice(text, error = false) {
    const node = $("#page-message");
    node.textContent = text;
    node.hidden = !text;
    node.classList.toggle("error", error);
    node.classList.toggle("success", !error);
  }
  function errorAt(selector, text) {
    const node = $(selector);
    node.textContent = text;
    node.hidden = !text;
    if (text) node.focus();
  }
  function focusHeading(panel) {
    const heading = $(`${panel} h2`);
    heading?.focus({ preventScroll: true });
    $(panel).scrollIntoView({ block: "start" });
  }
  function panel(id, moveFocus = true) {
    $$(".workspace > section").forEach((node) => {
      node.hidden = node.id !== id;
    });
    if (moveFocus) focusHeading(`#${id}`);
  }
  async function api(data) {
    let response;
    try {
      response = await fetch(endpoint, {
        method: data ? "POST" : "GET",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        cache: "no-store",
        ...(data ? { body: JSON.stringify(data) } : {}),
      });
    } catch {
      const error = new Error(
        "We couldn’t reach the server. Check your connection and try again. If this happened after sending a code, check your messages before requesting another.",
      );
      error.status = 0;
      throw error;
    }
    const result = await response.json().catch(() => ({}));
    if (response.status === 401 || result.status === "unauthorized") {
      clearPrivate();
      codes = "";
      busy = false;
      $("#backup-codes").textContent = "";
      location.replace("index.html?session=expired");
      throw new Error("Your session expired. Please sign in again.");
    }
    if (!response.ok) {
      const error = new Error(
        result.message ||
          "This action could not be completed. Please try again.",
      );
      error.status = response.status;
      throw error;
    }
    return result;
  }
  async function run(button, errorSelector, task) {
    if (busy) return;
    busy = true;
    errorAt(errorSelector, "");
    const controls = $$("button").map((node) => [node, node.disabled]);
    controls.forEach(([node]) => {
      node.disabled = true;
    });
    const label = button.innerHTML;
    button.textContent = "Please wait…";
    button.setAttribute("aria-busy", "true");
    try {
      await task();
    } catch (error) {
      errorAt(errorSelector, error.message || "Please try again.");
    } finally {
      busy = false;
      controls.forEach(([node, disabled]) => {
        node.disabled = disabled;
      });
      button.innerHTML = label;
      button.removeAttribute("aria-busy");
      updateTimers();
    }
  }
  function onSubmit(id, errorSelector, task) {
    $(id).addEventListener("submit", (event) => {
      event.preventDefault();
      run($(id).querySelector('button[type="submit"]'), errorSelector, task);
    });
  }
  function clearPrivate() {
    stopDeliveryChecks();
    password = "";
    phoneNumber = "";
    phoneProof = "";
    phoneDestination = "";
    pendingSetup = false;
    setupUntil = 0;
    $$("form").forEach((form) => form.reset());
    $$("[data-reveal]").forEach((button) => {
      $(`#${button.dataset.reveal}`).type = "password";
      button.textContent = "Show";
      button.setAttribute("aria-label", "Show current portal password");
    });
    $("#setup-key").textContent = "";
    $("#setup-qr").removeAttribute("src");
    $("#key-feedback").textContent = "";
    $$(".form-error").forEach((node) => {
      node.hidden = true;
      node.textContent = "";
    });
  }
  function renderStatus() {
    $("#auth-status").textContent = status.enabled ? "Connected" : "Not set up";
    $("#auth-status").classList.toggle("is-ready", status.enabled);
    $("#codes-status").textContent = `${status.remaining} unused`;
    $("#phone-status").textContent = status.phoneVerified
      ? "Verified"
      : "Not verified";
    $("#phone-status").classList.toggle("is-ready", !!status.phoneVerified);
    $("#codes-badge").textContent = `${status.remaining} unused`;
    $("#codes-badge").classList.toggle("warning", status.remaining === 0);
    $("#codes-description").textContent = status.remaining
      ? "Each saved code works once. Your existing codes cannot be displayed again. Lost your copy? Create a replacement set."
      : "You have no unused backup codes. Create and save a new set so recovery without email remains available.";
    $("#phone-description").textContent = status.phoneVerified
      ? `${status.maskedPhone || "Your registered phone"} is verified. SMS recovery also needs a saved backup code.`
      : "Add and verify your own mobile number as an optional recovery method. SMS recovery also needs a saved backup code.";
    $("#phone-open").textContent = status.phoneVerified
      ? "Change my recovery phone"
      : "Add my recovery phone";
  }
  async function refreshStatus() {
    const result = await api();
    if (result.status !== "ok" || typeof result.enabled !== "boolean")
      throw new Error(
        "Your recovery status could not be confirmed. Please try again.",
      );
    status = result;
    renderStatus();
  }
  async function afterChange(result, success) {
    notice(
      success +
        (result.noticeSent === false
          ? " The change succeeded, but its notification email could not be delivered."
          : ""),
    );
    try {
      await refreshStatus();
    } catch (error) {
      notice(
        `${success} The latest status could not be refreshed. Your completed change has not been undone. ${error.message}`,
        true,
      );
    }
  }
  function step(number) {
    $$("[data-step]").forEach((node) => {
      const n = Number(node.dataset.step);
      node.classList.toggle("done", n < number);
      if (n === number) node.setAttribute("aria-current", "step");
      else node.removeAttribute("aria-current");
      node.querySelector("span").textContent = n < number ? "✓" : String(n);
    });
    $("#identity-step").hidden = number !== 1;
    $("#connect-step").hidden = number !== 2;
  }
  function startSetup(replace = false, moveFocus = true) {
    clearPrivate();
    mode = replace ? "replace" : "setup";
    $("#setup-title").textContent = replace
      ? "Connect a new authenticator"
      : "Let’s secure your account";
    $("#setup-kicker").textContent = replace
      ? "Replace your connected app"
      : "Required · One-time setup";
    $("#setup-intro").textContent = replace
      ? "Approve this change using your current authenticator. Your old app and backup codes keep working until you confirm the new app. Then save the replacement backup codes."
      : "New student or moving to this portal? Complete these three steps before opening your dashboard. Your student number and password still work for normal sign-in.";
    $("#old-code-field").hidden = !replace;
    $("#old-app-code").required = replace;
    $("#setup [data-back]").hidden = !status.enabled;
    step(1);
    panel("setup", moveFocus);
  }
  async function load() {
    $("#retry-load").hidden = true;
    $("#loading-title").textContent = "Checking your account…";
    try {
      await refreshStatus();
      $("#loading").hidden = true;
      $("#security-content").hidden = false;
      $("#policies-panel").hidden = !!status.policiesAccepted;
      $("#settings-after-policies").hidden = !status.policiesAccepted;
      if (!status.policiesAccepted) {
        $("#policies-title").focus();
        return;
      }
      if (status.enabled) panel("overview", false);
      else {
        startSetup(false, false);
        if (new URLSearchParams(location.search).get("start") !== "1")
          window.StudentEnrollment.show({
            onSetup: () => $("#setup-password").focus(),
          });
      }
    } catch (error) {
      $("#loading-title").textContent = "We couldn’t load your settings";
      $("#loading-description").textContent = error.message;
      $("#retry-load").hidden = false;
    }
  }
  $("#retry-load").addEventListener("click", load);
  onSubmit("#policies-form", "#policies-error", async () => {
    await api({
      action: "accept_policies",
      termsAccepted: $("#terms-check").checked,
      privacyAccepted: $("#privacy-check").checked,
      policyVersion: status.policyVersion,
    });
    await load();
  });
  $$("[data-reveal]").forEach((button) =>
    button.addEventListener("click", () => {
      const input = $(`#${button.dataset.reveal}`),
        show = input.type === "password";
      input.type = show ? "text" : "password";
      button.textContent = show ? "Hide" : "Show";
      button.setAttribute(
        "aria-label",
        `${show ? "Hide" : "Show"} current portal password`,
      );
    }),
  );
  $$(".code-input").forEach((input) =>
    input.addEventListener("input", () => {
      input.value = input.value.replace(/\D/g, "").slice(0, 6);
    }),
  );
  onSubmit("#identity-form", "#identity-error", async () => {
    const proof = $("#setup-password").value;
    const result = await api({
      action: "begin",
      password: proof,
      code: $("#old-app-code").value.trim(),
    });
    if (!result.secret || !result.qr)
      throw new Error("Setup could not be started. Please try again.");
    password = proof;
    $("#identity-form").reset();
    $("#setup-password").type = "password";
    pendingSetup = true;
    setupUntil = Date.now() + 10 * 60 * 1000;
    $("#setup-key").textContent = result.secret;
    $("#setup-qr").src = result.qr;
    step(2);
    $("#connect-step").scrollIntoView({ block: "start" });
    $("#new-app-code").focus({ preventScroll: true });
  });
  function showCodes(result, source) {
    if (!Array.isArray(result.codes) || !result.codes.length)
      throw new Error(
        "No backup codes were returned. Check your recovery settings before trying again.",
      );
    clearPrivate();
    codeSource = source;
    codes = result.codes.join("\n");
    $("#backup-codes").textContent = codes;
    $("#backup-kicker").textContent =
      source === "setup"
        ? "Step 3 of 3 · App connected"
        : "Your replacement set";
    $("#backup-feedback").textContent = "";
    panel("backup-panel");
  }
  onSubmit("#connect-form", "#connect-error", async () => {
    if (!pendingSetup || Date.now() >= setupUntil)
      throw new Error(
        "This setup expired. Choose Start setup again to get a fresh QR code.",
      );
    const result = await api({
      action: "confirm",
      password,
      code: $("#new-app-code").value.trim(),
    });
    status.enabled = true;
    status.remaining = result.codes?.length || 0;
    renderStatus();
    showCodes(result, "setup");
    await afterChange(
      result,
      "Authenticator connected. Save your backup codes to finish.",
    );
  });
  $("#restart-setup").addEventListener("click", () => {
    startSetup(status.enabled);
    $("#setup-password").focus();
  });
  async function copy(text, feedback) {
    try {
      await navigator.clipboard.writeText(text);
      $(feedback).textContent =
        "Copied. Keep it private and save it somewhere safe.";
    } catch {
      $(feedback).textContent =
        "Copy is unavailable in this browser. Select the text to copy it manually, or download your backup codes.";
    }
  }
  $("#copy-key").addEventListener("click", () =>
    copy($("#setup-key").textContent, "#key-feedback"),
  );
  $("#copy-codes").addEventListener("click", () =>
    copy(codes, "#backup-feedback"),
  );
  $("#download-codes").addEventListener("click", () => {
    if (!codes) return;
    const blob = new Blob(
      [
        "Reset Workflow backup recovery codes\nKeep private. Each code works once with your authenticator or verified phone.\n\n" +
          codes,
      ],
      { type: "text/plain" },
    );
    const url = URL.createObjectURL(blob),
      link = document.createElement("a");
    link.href = url;
    link.download = "reset-workflow-recovery-codes.txt";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    $("#backup-feedback").textContent =
      "Download requested. Check your Downloads folder before finishing.";
  });
  $("#print-codes").addEventListener("click", () => window.print());
  $("#saved-form").addEventListener("submit", (event) => {
    event.preventDefault();
    codes = "";
    $("#backup-codes").textContent = "";
    notice("");
    panel(codeSource === "setup" ? "complete-panel" : "overview");
  });
  function overview() {
    clearPrivate();
    notice("");
    if (status.enabled) panel("overview");
    else startSetup();
  }
  $("#manage-methods").addEventListener("click", overview);
  $$("[data-back]").forEach((button) =>
    button.addEventListener("click", overview),
  );
  $$("[data-open]").forEach((button) =>
    button.addEventListener("click", () => {
      notice("");
      if (button.dataset.open === "replace") return startSetup(true);
      clearPrivate();
      mode = button.dataset.open;
      const phone = mode === "phone",
        remove = mode === "disable";
      $("#manage-title").textContent = phone
        ? "Add or change your recovery phone"
        : remove
          ? "Remove your authenticator?"
          : "Create replacement backup codes";
      $("#manage-description").textContent = phone
        ? "Enter a mobile number you control. Approve it with your password and a fresh authenticator code, then verify the SMS. Your old number, if any, stays active until verification succeeds."
        : remove
          ? "This removes your connected app and invalidates every backup code. You must set up an authenticator again before opening the portal."
          : "Use your current password and a fresh authenticator code to create ten new single-use backup codes.";
      $("#manage-warning").hidden = phone;
      $("#manage-warning").textContent = remove
        ? "If you are changing phones, cancel and use Change authenticator instead. If you lost your authenticator, request administrator assistance."
        : "All previous backup codes and pending alternate-recovery requests will stop working immediately. Save the new set before leaving.";
      $("#manage-code-field").hidden = false;
      $("#manage-code").required = true;
      $("#new-phone-field").hidden = !phone;
      $("#new-phone").required = phone;
      $("#confirm-change-label").hidden = phone;
      $("#confirm-change").required = !phone;
      $("#confirm-change-text").textContent = remove
        ? "I understand I must enroll again to use the portal."
        : "I understand my previous backup codes will no longer work.";
      $("#manage-submit").textContent = phone
        ? "Send verification SMS"
        : remove
          ? "Remove authenticator"
          : "Create new backup codes";
      $("#manage-submit").classList.toggle("danger", remove);
      $("#manage-form").hidden = false;
      $("#phone-form").hidden = true;
      panel("manage-panel");
    }),
  );
  async function sendSms() {
    stopDeliveryChecks();
    // Start cooldown before the request; an uncertain delivery must not cause repeats.
    smsUntil = Date.now() + 60 * 1000;
    try {
      const result = await api({
        action: "phone_start",
        password,
        phone: phoneNumber,
        code: phoneProof,
      });
      phoneDestination = result.maskedPhone || "the number you entered";
      phoneProof = "";
      errorAt("#phone-error", "");
      deliveryReceipt = result.deliveryReceipt || "";
      showDelivery(result.deliveryStatus || "unknown", result.deliveryIssue);
    } catch (error) {
      if (![0, 502].includes(error.status)) throw error;
      showDelivery("unknown");
      errorAt("#phone-error", error.message);
    }
    $("#manage-form").reset();
    $("#manage-form").hidden = true;
    $("#phone-form").hidden = false;
    $("#sms-destination").textContent =
      `A verification SMS was requested for ${phoneDestination || "the number you entered"}. Check that phone for the latest code. Your number is not changed until verification succeeds.`;
    $("#sms-code").value = "";
    $("#sms-code").focus();
    if (deliveryReceipt && deliveryStatus === "pending")
      deliveryTimer = setTimeout(checkDelivery, 3000);
  }
  onSubmit("#manage-form", "#manage-error", async () => {
    const proof = $("#manage-password").value;
    if (mode === "phone") {
      if (Date.now() < smsUntil)
        throw new Error(
          "Please wait at least 60 seconds between SMS requests. If a code already arrived, return to phone verification without requesting another.",
        );
      password = proof;
      phoneNumber = $("#new-phone").value.trim();
      phoneProof = $("#manage-code").value.trim();
      try {
        await sendSms();
      } catch (error) {
        password = "";
        throw error;
      }
      return;
    }
    const result = await api({
      action: mode,
      password: proof,
      code: $("#manage-code").value.trim(),
    });
    if (mode === "codes") {
      status.remaining = result.codes?.length || 0;
      showCodes(result, "replacement");
    } else {
      status.enabled = false;
      status.remaining = 0;
      startSetup();
    }
    renderStatus();
    await afterChange(
      result,
      mode === "setup"
        ? "Authenticator removed. Complete setup again before opening the portal."
        : "New backup codes created. Save this set before leaving.",
    );
  });
  onSubmit("#phone-form", "#phone-error", async () => {
    const result = await api({
      action: "phone_confirm",
      password,
      code: $("#sms-code").value.trim(),
    });
    status.phoneVerified = true;
    clearPrivate();
    panel("overview");
    renderStatus();
    await afterChange(
      result,
      "Phone verified. You can use an SMS code together with a saved backup code to recover without email.",
    );
  });
  $("#resend-sms").addEventListener("click", () => {
    if (Date.now() < smsUntil || deliveryIssue) return;
    run($("#resend-sms"), "#phone-error", sendSms);
  });
  $("#check-sms-delivery").addEventListener("click", checkDelivery);
  function updateTimers() {
    const remaining = Math.max(0, Math.ceil((setupUntil - Date.now()) / 1000));
    if (pendingSetup) {
      $("#setup-time").textContent = remaining
        ? `Confirm within ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}.`
        : "Setup expired. Start again for a fresh QR code.";
      $("#confirm-app").disabled = busy || !remaining;
    }
    const smsWait = Math.max(0, Math.ceil((smsUntil - Date.now()) / 1000));
    $("#resend-sms").disabled = busy || smsWait > 0 || !!deliveryIssue;
    $("#check-sms-delivery").hidden =
      !deliveryReceipt || ["sent", "failed"].includes(deliveryStatus);
    $("#check-sms-delivery").disabled =
      busy || deliveryBusy || deliveryChecks >= 10;
    $("#check-sms-delivery").textContent = deliveryBusy
      ? "Checking SMS status…"
      : "Check SMS status";
    $("#sms-wait").textContent = deliveryIssue
      ? "Sending the same message again will not resolve this rejection. You can cancel and keep using your current recovery methods while the administrator contacts the SMS service."
      : smsWait
        ? `You can request another SMS in ${smsWait} seconds.`
        : "No SMS yet? You can request another code. Delivery depends on your mobile network.";
  }
  setInterval(updateTimers, 1000);
  window.addEventListener("beforeunload", (event) => {
    if (codes || pendingSetup || busy) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  // Do not restore secrets or stale task state from the back-forward cache.
  window.addEventListener("pagehide", () => {
    clearPrivate();
    codes = "";
    $("#backup-codes").textContent = "";
  });
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) location.reload();
  });
  const leave = $("#leave-dialog");
  $("#sign-out").addEventListener("click", () => {
    $("#leave-description").textContent = codes
      ? "Your new backup codes are still on this page. Save them before signing out; they cannot be shown again."
      : "Any unfinished setup will need to be started again.";
    leave.showModal();
    $("#cancel-signout").focus();
  });
  $("#cancel-signout").addEventListener("click", () => leave.close());
  $("#confirm-signout").addEventListener("click", () =>
    run($("#confirm-signout"), "#logout-error", async () => {
      const response = await fetch("/api/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!response.ok)
        throw new Error("We couldn’t sign you out. Please try again.");
      clearPrivate();
      codes = "";
      busy = false;
      $("#backup-codes").textContent = "";
      location.replace("index.html?signedOut=1");
    }),
  );
  load();
})();
