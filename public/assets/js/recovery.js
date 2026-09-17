(() => {
  "use strict";
  const $ = (selector) => document.querySelector(selector);
  const page = document.body.dataset.recoveryPage;
  let token = "",
    csrf = "",
    savedCodes = "",
    dirtyCodes = false;
  const message = (text, error = false) => {
    const node = $("#sr-message");
    node.hidden = false;
    node.textContent = text;
    node.classList.toggle("error", error);
    node.focus();
  };
  async function api(path, data) {
    const response = await fetch(path, {
      method: data ? "POST" : "GET",
      headers: {
        "Content-Type": "application/json",
        ...(csrf ? { "X-Admin-CSRF": csrf } : {}),
      },
      ...(data ? { body: JSON.stringify(data) } : {}),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401 && page === "security")
        location.replace("index.html?session=expired");
      if (response.status === 401 && page === "admin-recovery")
        location.replace("login.html");
      throw new Error(
        result.message ||
          "The service could not complete your request. Please try again.",
      );
    }
    return result;
  }
  async function busy(element, task) {
    const buttons = [...document.querySelectorAll("button")];
    if (element.disabled) return;
    buttons.forEach((button) => (button.disabled = true));
    try {
      await task();
    } catch (error) {
      message(error.message || "Check your connection and try again.", true);
    } finally {
      buttons.forEach((button) => (button.disabled = false));
    }
  }
  function showCodes(codes) {
    savedCodes = codes.join("\n");
    dirtyCodes = true;
    $("#backup-codes").textContent = savedCodes;
    $("#backup-output").hidden = false;
    $("#backup-output").scrollIntoView({ behavior: "smooth", block: "start" });
  }
  async function loadSecurity() {
    const status = await api("/.netlify/functions/security-settings");
    if (status.status !== "ok")
      throw new Error("Sign in again to view your security settings.");
    $("#security-status").textContent =
      `Authenticator: ${status.enabled ? "enrolled" : "not enrolled"} · Phone: ${status.phoneVerified ? "verified" : "not verified"} · Unused backup codes: ${status.remaining}`;
  }
  if (page === "security") {
    loadSecurity().catch((error) => {
      $("#security-status").textContent =
        "Security settings could not be loaded. Refresh this page to retry.";
      message(error.message, true);
    });
    document.querySelectorAll("[data-action]").forEach((button) =>
      button.addEventListener("click", () =>
        busy(button, async () => {
          const action = button.dataset.action;
          if (
            ["codes", "disable", "begin"].includes(action) &&
            !confirm(
              action === "disable"
                ? "Remove your authenticator and invalidate all backup codes? Make sure you still have another recovery method."
                : "Continue with this security change? Replacing backup codes invalidates the previous set.",
            )
          )
            return;
          const password = $("#current-password").value;
          if (!password) throw new Error("Enter your current password above.");
          const result = await api("/.netlify/functions/security-settings", {
            action,
            password,
            code: $("#factor-code").value.trim(),
          });
          $("#factor-code").value = "";
          if (result.secret) {
            $("#setup-key").textContent = result.secret;
            $("#qr").src = result.qr;
            $("#enrollment").hidden = false;
          }
          if (action === "confirm" || action === "disable") {
            $("#enrollment").hidden = true;
            $("#setup-key").textContent = "";
            $("#qr").removeAttribute("src");
          }
          if (result.codes) showCodes(result.codes);
          message(
            result.message +
              (result.noticeSent === false
                ? " Your security change succeeded, but its notification email could not be delivered."
                : ""),
          );
          await loadSecurity();
        }),
      ),
    );
    $("#copy-codes").addEventListener("click", () =>
      busy($("#copy-codes"), async () => {
        await navigator.clipboard.writeText(savedCodes);
        message("Codes copied. Store them somewhere safe.");
      }),
    );
    $("#download-codes").addEventListener("click", () => {
      const url = URL.createObjectURL(
        new Blob(
          [
            "Reset Workflow backup recovery codes\nKeep private. Each code works once with your enrolled authenticator or verified phone.\n\n" +
              savedCodes,
          ],
          { type: "text/plain" },
        ),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = "reset-workflow-recovery-codes.txt";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    $("#print-codes").addEventListener("click", () => window.print());
    $("#saved-codes").addEventListener("click", () => {
      dirtyCodes = false;
      savedCodes = "";
      $("#backup-codes").textContent = "";
      $("#backup-output").hidden = true;
      message("Keep your saved codes safe. They cannot be displayed again.");
    });
    window.addEventListener("beforeunload", (event) => {
      if (dirtyCodes) {
        event.preventDefault();
        event.returnValue = "";
      }
    });
  }
  function onForm(selector, task) {
    const form = $(selector);
    if (!form) return;
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      busy(form.querySelector("button"), () =>
        task(Object.fromEntries(new FormData(form)), form),
      );
    });
  }
  onForm("#alternate-start", async (data, form) => {
    const result = await api("/.netlify/functions/alternate-recovery", {
      action: "start",
      ...data,
    });
    token = result.token;
    form.reset();
    form.hidden = true;
    $("#alternate-verify").hidden = false;
    $("#verification-help").textContent = result.message;
    $("#recovery-otp").focus();
  });
  onForm("#alternate-verify", async (data, form) => {
    const result = await api("/.netlify/functions/alternate-recovery", {
      action: "verify",
      token,
      ...data,
    });
    form.reset();
    form.hidden = true;
    $("#alternate-complete").hidden = false;
    message(result.message);
    $("#new-password").focus();
  });
  onForm("#alternate-complete", async (data, form) => {
    if (data.password !== data.confirmation)
      throw new Error("The passwords do not match.");
    const result = await api("/.netlify/functions/alternate-recovery", {
      action: "complete",
      token,
      password: data.password,
    });
    token = "";
    form.reset();
    form.hidden = true;
    $("#recovery-success").hidden = false;
    message(
      result.message +
        (result.noticeSent === false
          ? " The notification email could not be delivered."
          : ""),
    );
  });
  onForm("#help-form", async (data, form) => {
    const result = await api("/.netlify/functions/alternate-recovery", {
      action: "help",
      ...data,
    });
    form.reset();
    form.hidden = true;
    message(result.message);
  });
  async function loadRequests() {
    const result = await api("/.netlify/functions/admin-recovery");
    const host = $("#help-requests");
    host.replaceChildren();
    if (!result.requests.length) {
      host.textContent = "No recovery assistance requests.";
      return;
    }
    for (const item of result.requests) {
      const card = document.createElement("section");
      card.className = "sr-card sr-request";
      const heading = document.createElement("h2");
      heading.textContent = `Student ${item.student_number} · ${item.status}`;
      card.append(heading);
      for (const text of [
        `Submitted: ${new Date(item.created_at).toLocaleString()}`,
        `Unverified contact: ${item.contact}`,
        item.message,
      ]) {
        const p = document.createElement("p");
        p.textContent = text;
        card.append(p);
      }
      const label = document.createElement("label");
      label.textContent = "Review status";
      const select = document.createElement("select");
      select.setAttribute(
        "aria-label",
        `Review status for ${item.student_number}`,
      );
      for (const value of ["reviewing", "resolved", "declined"]) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = value;
        select.append(option);
      }
      select.value = item.status === "pending" ? "reviewing" : item.status;
      label.append(select);
      card.append(label);
      const noteLabel = document.createElement("label");
      noteLabel.textContent = "Review note (no sensitive identity evidence)";
      const note = document.createElement("textarea");
      note.rows = 3;
      note.maxLength = 1000;
      note.value = item.review_note || "";
      noteLabel.append(note);
      card.append(noteLabel);
      const button = document.createElement("button");
      button.textContent = "Save review";
      button.addEventListener("click", () =>
        busy(button, async () => {
          const result = await api("/.netlify/functions/admin-recovery", {
            id: item.id,
            status: select.value,
            note: note.value,
          });
          message(result.message);
          await loadRequests();
        }),
      );
      card.append(button);
      host.append(card);
    }
  }
  if (page === "admin-recovery") {
    api("/api/admin/session")
      .then((result) => {
        csrf = result.csrfToken;
        return loadRequests();
      })
      .catch((error) => message(error.message, true));
    $("#refresh-requests").addEventListener("click", () =>
      busy($("#refresh-requests"), loadRequests),
    );
  }
})();
