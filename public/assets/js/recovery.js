(() => {
  "use strict";
  const $ = (selector) => document.querySelector(selector);
  let token = "";
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
      },
      ...(data ? { body: JSON.stringify(data) } : {}),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
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
})();
