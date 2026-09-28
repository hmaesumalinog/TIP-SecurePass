import { createRefreshScheduler } from "./refresh-scheduler.mjs";

(function () {
  "use strict";

  const page = document.body.dataset.adminPage;
  let csrfToken = "";
  let students = [];
  let refreshScheduler;
  const $ = (selector, parent = document) => parent.querySelector(selector);
  const $$ = (selector, parent = document) => [
    ...parent.querySelectorAll(selector),
  ];

  async function request(url, options = {}) {
    const headers = new Headers(options.headers || {});
    headers.set("Accept", "application/json");
    if (options.body) headers.set("Content-Type", "application/json");
    if (csrfToken && options.method && options.method !== "GET")
      headers.set("X-Admin-CSRF", csrfToken);
    let response;
    try {
      response = await fetch(url, {
        ...options,
        headers,
        cache: "no-store",
        signal: options.signal || AbortSignal.timeout(20000),
      });
    } catch {
      throw new Error(
        "We could not reach the server. Check your internet connection and try again.",
      );
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(
        data.message || "The administrator request could not be completed.",
      );
      error.status = response.status;
      throw error;
    }
    return data;
  }

  function setBusy(button, busy, label) {
    if (!button) return;
    if (busy) {
      button.dataset.original = button.innerHTML;
      button.disabled = true;
      button.textContent = label;
    } else {
      button.disabled = false;
      button.innerHTML = button.dataset.original || label;
    }
  }

  function showToast(message, error = false) {
    const toast = $("#admin-toast");
    if (!toast) return;
    toast.textContent = message;
    toast.classList.toggle("error", error);
    toast.classList.remove("hidden");
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(
      () => toast.classList.add("hidden"),
      4800,
    );
  }

  function formatTime(value) {
    if (!value) return "—";
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  }

  // "5 minutes ago" for recent events; older events show only the date.
  function relativeTime(value) {
    const then = new Date(value).getTime();
    if (!Number.isFinite(then)) return "";
    const seconds = Math.round((Date.now() - then) / 1000);
    if (seconds < 45) return "Just now";
    const format = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return format.format(-minutes, "minute");
    const hours = Math.round(minutes / 60);
    if (hours < 24) return format.format(-hours, "hour");
    const days = Math.round(hours / 24);
    return days < 7 ? format.format(-days, "day") : "";
  }

  function dayLabel(value) {
    const date = new Date(value);
    const today = new Date();
    const start = (day) =>
      new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
    const difference = Math.round((start(today) - start(date)) / 86400000);
    if (difference === 0) return "Today";
    if (difference === 1) return "Yesterday";
    return new Intl.DateTimeFormat(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: date.getFullYear() === today.getFullYear() ? undefined : "numeric",
    }).format(date);
  }

  function readableDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return value;
    return new Intl.DateTimeFormat("en", {
      dateStyle: "long",
      timeZone: "UTC",
    }).format(new Date(`${value}T00:00:00Z`));
  }

  function waitingLabel(value) {
    const hours = (Date.now() - new Date(value).getTime()) / 3600000;
    if (!Number.isFinite(hours)) return "";
    if (hours < 1) return "Waiting under an hour";
    if (hours < 24) {
      const rounded = Math.round(hours);
      return `Waiting ${rounded} hour${rounded === 1 ? "" : "s"}`;
    }
    const days = Math.floor(hours / 24);
    return `Waiting ${days} day${days === 1 ? "" : "s"}`;
  }

  function labelEvent(value) {
    return String(value || "")
      .replaceAll("_", " ")
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  function node(tag, text, className) {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (className) element.className = className;
    return element;
  }

  function cell(row, label, value, className = "") {
    const td = document.createElement("td");
    td.dataset.label = label;
    if (className) td.className = className;
    if (value instanceof Node) td.append(value);
    else td.textContent = value ?? "—";
    row.append(td);
    return td;
  }

  // Styled replacement for window.confirm(); resolves true when confirmed.
  function confirmDialog({
    title,
    message,
    confirmLabel = "Continue",
    cancelLabel = "Cancel",
    danger = false,
  }) {
    return new Promise((resolve) => {
      const dialog = node("dialog", undefined, "ui-dialog");
      dialog.classList.toggle("is-danger", danger);
      dialog.setAttribute("aria-labelledby", "confirm-dialog-title");
      dialog.setAttribute("aria-describedby", "confirm-dialog-message");
      const card = node("div", undefined, "ui-dialog-card");
      const icon = node("div", danger ? "!" : "?", "ui-dialog-icon");
      icon.setAttribute("aria-hidden", "true");
      const heading = node("h2", title);
      heading.id = "confirm-dialog-title";
      const copy = node("p", message);
      copy.id = "confirm-dialog-message";
      const actions = node("div", undefined, "ui-dialog-actions");
      const cancel = node("button", cancelLabel, "ui-btn secondary");
      cancel.type = "button";
      const confirm = node(
        "button",
        confirmLabel,
        danger ? "ui-btn danger" : "ui-btn",
      );
      confirm.type = "button";
      actions.append(cancel, confirm);
      card.append(icon, heading, copy, actions);
      dialog.append(card);
      const opener = document.activeElement;
      let confirmed = false;
      cancel.addEventListener("click", () => dialog.close());
      confirm.addEventListener("click", () => {
        confirmed = true;
        dialog.close();
      });
      dialog.addEventListener("click", (event) => {
        if (event.target === dialog) dialog.close();
      });
      dialog.addEventListener("close", () => {
        dialog.remove();
        if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
        resolve(confirmed);
      });
      document.body.append(dialog);
      dialog.showModal();
      cancel.focus();
    });
  }

  // Password fields: Show/Hide toggle and Caps Lock hint.
  $$("[data-reveal]").forEach((button) =>
    button.addEventListener("click", () => {
      const input = document.getElementById(button.dataset.reveal);
      const revealing = input.type === "password";
      input.type = revealing ? "text" : "password";
      button.textContent = revealing ? "Hide" : "Show";
      button.setAttribute("aria-pressed", String(revealing));
      button.setAttribute(
        "aria-label",
        revealing ? "Hide password" : "Show password",
      );
    }),
  );
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

  async function requireSession() {
    try {
      const data = await request("/api/admin/session");
      csrfToken = data.csrfToken;
      return data.admin;
    } catch (error) {
      if (error.status === 401 || error.status === 403)
        window.location.replace("login.html?session=expired");
      else showToast(error.message, true);
      return null;
    }
  }

  function scheduleRefresh(callback) {
    refreshScheduler?.stop();
    refreshScheduler = createRefreshScheduler(callback);
  }

  function initLogin() {
    const params = new URLSearchParams(location.search);
    if (params.get("session") === "expired") {
      showToast(
        "Your administrator session timed out. Please sign in again.",
        true,
      );
      history.replaceState({}, "", location.pathname);
    } else if (params.get("signedOut") === "1") {
      showToast("You have been signed out of the administrator area.");
      history.replaceState({}, "", location.pathname);
    }

    request("/api/admin/session")
      .then(() => window.location.replace("dashboard.html"))
      .catch(() => {});
    const form = $("#admin-login-form");
    const otpForm = $("#admin-otp-form");
    const email = $("#admin-email");
    const password = $("#admin-password");
    const code = $("#admin-otp");
    let challengeId = "";

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const error = $("#admin-login-error");
      const button = $('button[type="submit"]', form);
      error.textContent = "";
      if (!email.validity.valid || !email.value.trim() || !password.value) {
        error.textContent =
          "Enter the authorized administrator email and password.";
        (email.value.trim() && email.validity.valid ? password : email).focus();
        return;
      }
      setBusy(button, true, "Sending verification code…");
      try {
        const data = await request("/api/admin/login-start", {
          method: "POST",
          body: JSON.stringify({
            email: email.value.trim(),
            password: password.value,
          }),
        });
        challengeId = data.challengeId;
        $("#otp-email").textContent = email.value.trim();
        $("#credentials-view").classList.add("hidden");
        $("#otp-view").classList.remove("hidden");
        code.focus();
      } catch (loginError) {
        error.textContent = loginError.message;
      } finally {
        setBusy(button, false, "Continue securely");
      }
    });

    code.addEventListener("input", () => {
      code.value = code.value.replace(/\D/g, "").slice(0, 6);
      $("#admin-otp-error").textContent = "";
    });
    otpForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const error = $("#admin-otp-error");
      const button = $('button[type="submit"]', otpForm);
      error.textContent = "";
      if (!/^\d{6}$/.test(code.value)) {
        error.textContent = "Enter the complete six-digit code.";
        code.focus();
        return;
      }
      setBusy(button, true, "Verifying…");
      try {
        await request("/api/admin/login-verify", {
          method: "POST",
          body: JSON.stringify({ challengeId, code: code.value }),
        });
        window.location.assign("dashboard.html");
      } catch (otpError) {
        error.textContent = otpError.message;
        code.select();
      } finally {
        setBusy(button, false, "Verify and open dashboard");
      }
    });
    $("#back-to-login").addEventListener("click", () => {
      challengeId = "";
      code.value = "";
      $("#otp-view").classList.add("hidden");
      $("#credentials-view").classList.remove("hidden");
      password.value = "";
      password.focus();
    });
  }

  let adminAccount,
    pageNumber = 1,
    loading = false,
    selectedStudent = null,
    selectedRequest = null,
    lastEvents = [];
  const statusNames = {
    invited: "Waiting for first login",
    setup: "Setup incomplete",
    ready: "Recovery ready",
    attention: "Backup codes needed",
    inactive: "Inactive",
  };
  const statusTones = {
    invited: "info",
    setup: "pending",
    ready: "",
    attention: "danger",
    inactive: "neutral",
  };
  const requestTones = {
    pending: "pending",
    reviewing: "info",
    resolved: "",
    declined: "neutral",
  };
  const programShort = {
    "Bachelor of Science in Architecture": "BS Arch",
    "Bachelor of Science in Civil Engineering": "BSCE",
    "Bachelor of Science in Computer Engineering": "BSCpE",
    "Bachelor of Science in Electrical Engineering": "BSEE",
    "Bachelor of Science in Electronics Engineering": "BSECE",
    "Bachelor of Science in Environmental and Sanitary Engineering": "BSEnSE",
    "Bachelor of Science in Industrial Engineering": "BSIE",
    "Bachelor of Science in Mechanical Engineering": "BSME",
    "Bachelor of Science in Computer Science": "BSCS",
    "Bachelor of Science in Data Science and Analytics": "BSDSA",
    "Bachelor of Science in Information Systems": "BSIS",
    "Bachelor of Science in Information Technology": "BSIT",
    "Bachelor of Science in Accountancy": "BSA",
    "Bachelor of Science in Accounting Information Systems": "BSAIS",
    "Bachelor of Science in Business Administration major in Financial Management":
      "BSBA-FM",
    "Bachelor of Science in Business Administration major in Human Resource Management":
      "BSBA-HRM",
    "Bachelor of Science in Business Administration major in Logistics and Supply Management":
      "BSBA-LSM",
    "Bachelor of Science in Business Administration major in Marketing Management":
      "BSBA-MM",
    "Bachelor of Secondary Education major in English": "BSEd-English",
    "Bachelor of Secondary Education major in Mathematics": "BSEd-Math",
    "Bachelor of Secondary Education major in Sciences": "BSEd-Science",
    "Bachelor of Special Needs Education": "BSNEd",
    "Teaching Certificate Program": "TCP",
    "Bachelor of Arts in Political Science": "AB PolSci",
    "Bachelor of Arts in Psychology": "AB Psych",
  };
  const eventNames = {
    login_failed: [
      "Sign-in unsuccessful",
      "Check for repeated attempts; one failed sign-in does not prove an attack.",
      "warning",
    ],
    login_succeeded: ["Student signed in", "Credentials accepted.", "success"],
    password_reset_completed: [
      "Password reset completed",
      "Email and phone recovery completed; previous sessions invalidated.",
      "success",
    ],
    alternate_password_reset_completed: [
      "Backup recovery completed",
      "Backup code and enrolled recovery factor verified.",
      "success",
    ],
    recovery_begin: [
      "Authenticator setup started",
      "Not connected until a valid app code is confirmed.",
      "info",
    ],
    recovery_confirm: [
      "Authenticator connected",
      "App ownership confirmed; new backup codes issued.",
      "success",
    ],
    recovery_codes: [
      "Backup codes replaced",
      "Previous backup codes invalidated.",
      "info",
    ],
    recovery_disable: [
      "Authenticator removed",
      "Student must enroll again before portal access.",
      "warning",
    ],
    recovery_phone_start: [
      "Phone verification requested",
      "An SMS was requested. This is not proof of delivery.",
      "info",
    ],
    recovery_phone_confirm: [
      "Recovery phone verified",
      "Student proved ownership of their mobile number.",
      "success",
    ],
    policies_accepted: [
      "Terms and privacy acknowledged",
      "Versioned acknowledgment saved for this student.",
      "success",
    ],
    student_created: [
      "Student invited",
      "Account created; check the invitation email outcome.",
      "info",
    ],
    student_account_created: [
      "Student account created",
      "Waiting for the student to complete setup.",
      "info",
    ],
    student_welcome_email_failed: [
      "Invitation email failed",
      "Open the student record and reissue the invitation.",
      "warning",
    ],
    student_temporary_password_email_failed: [
      "Invitation resend failed",
      "Previous credentials were not changed.",
      "warning",
    ],
    student_temporary_password_issued: [
      "Invitation reissued",
      "The previous temporary password no longer works.",
      "info",
    ],
    first_login_password_completed: [
      "Personal password created",
      "Temporary password invalidated.",
      "success",
    ],
    student_deactivated: [
      "Account deactivated",
      "Student access is blocked.",
      "warning",
    ],
    student_profile_updated: [
      "Student record updated",
      "Administrative profile details changed.",
      "info",
    ],
    recovery_request_reviewed: [
      "Assistance review updated",
      "A review was recorded; no credentials or factors were changed.",
      "info",
    ],
    reset_requested: [
      "Password reset requested",
      "A request does not mean a password was changed.",
      "info",
    ],
    student_reset_email_sent: [
      "Reset email accepted by provider",
      "Inbox placement and delivery are controlled by the email provider.",
      "info",
    ],
  };
  function describeEvent(event) {
    return (
      eventNames[event.event_type] || [
        labelEvent(event.event_type),
        "Recorded security activity.",
        /failed|locked|rejected/.test(event.event_type) ? "warning" : "info",
      ]
    );
  }
  function badge(text, type = "") {
    return node("span", text, ("admin-status " + type).trim());
  }
  function studentStatus(student) {
    if (student.invitation_expired) return ["Invitation expired", "danger"];
    return [
      statusNames[student.security_status] || "Unknown",
      statusTones[student.security_status] ?? "neutral",
    ];
  }
  function action(label, callback, secondary = true, accessibleName = "") {
    const button = node(
      "button",
      label,
      "admin-button small" + (secondary ? " secondary" : ""),
    );
    button.type = "button";
    if (accessibleName) button.setAttribute("aria-label", accessibleName);
    button.addEventListener("click", () => callback(button));
    return button;
  }
  function pageState(text, error = false) {
    const target = $("#page-state");
    target.textContent = text;
    target.classList.toggle("is-error", error);
  }
  function emptyRow(body, columns, message) {
    const row = document.createElement("tr");
    cell(row, "", message, "admin-empty").colSpan = columns;
    body.append(row);
  }
  function timeCell(value) {
    const wrapper = node("span");
    const relative = relativeTime(value);
    if (relative) wrapper.append(node("strong", relative));
    wrapper.append(node("span", formatTime(value)));
    return wrapper;
  }

  // Filter chips behave like a single-choice group.
  function chipValue(id) {
    return $(`#${id} [aria-pressed="true"]`)?.dataset.value ?? "";
  }
  function setChip(id, value) {
    const chips = $$(`#${id} .filter-chip`);
    const match = chips.some((chip) => chip.dataset.value === value);
    chips.forEach((chip, index) =>
      chip.setAttribute(
        "aria-pressed",
        String(match ? chip.dataset.value === value : index === 0),
      ),
    );
  }
  function bindChips(onChange) {
    $$("[data-chip-group]").forEach((group) =>
      group.addEventListener("click", (event) => {
        const chip = event.target.closest(".filter-chip");
        if (!chip || chip.getAttribute("aria-pressed") === "true") return;
        setChip(group.id, chip.dataset.value);
        onChange();
      }),
    );
  }

  function renderIdentity(admin) {
    const name = admin.displayName || admin.email || "Administrator";
    $("#admin-identity-name").textContent = name;
    $("#admin-identity-role").textContent =
      admin.role === "super_admin" ? "Super administrator" : "Administrator";
    $("#admin-avatar").textContent =
      name
        .split(/[\s@._-]+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0].toUpperCase())
        .join("") || "A";
    $("#admin-identity").title = admin.email || name;
    $("#admin-identity").hidden = false;
    if (admin.role !== "super_admin")
      $$('.admin-nav a[href="recovery.html"]').forEach((link) => {
        if (!link.hasAttribute("aria-current")) link.hidden = true;
      });
  }

  function setRequestBadge(count, more = false) {
    $$("[data-request-badge]").forEach((badgeNode) => {
      badgeNode.hidden = !count;
      badgeNode.replaceChildren(
        document.createTextNode(more ? "20+" : String(count)),
        node("span", " open", "sr-only"),
      );
    });
  }
  function updateRequestBadge(data) {
    if (adminAccount?.role === "super_admin")
      setRequestBadge(Number(data.pendingRequests) || 0);
  }

  function renderEvents(body, events, full = false) {
    body.replaceChildren();
    if (!events.length)
      return emptyRow(body, full ? 4 : 3, "No activity matches this view.");
    let currentDay = "";
    events.forEach((event) => {
      if (full) {
        const day = dayLabel(event.created_at);
        if (day !== currentDay) {
          currentDay = day;
          const groupRow = node("tr", undefined, "admin-group-row");
          const heading = node("th", day);
          heading.colSpan = 4;
          heading.scope = "colgroup";
          groupRow.append(heading);
          body.append(groupRow);
        }
      }
      const row = node("tr");
      const [title, explanation, kind] = describeEvent(event);
      const summary = node("div");
      summary.append(
        node("strong", title),
        node("p", explanation, "admin-subtext"),
      );
      const technical = node("details");
      technical.append(
        node("summary", "Event reference"),
        node("code", event.event_type + " · " + event.id),
      );
      summary.append(technical);
      cell(row, "Activity", summary);
      const person = node("div", event.student_name || "No student linked");
      person.append(
        node(
          "small",
          event.student_number ||
            (event.source === "admin" ? "Administration" : "System event"),
          "admin-subtext",
        ),
      );
      cell(row, "Student", person);
      if (full) {
        const actor = node("div", event.actor);
        actor.append(document.createElement("br"));
        actor.append(
          badge(
            kind === "warning"
              ? "Review if repeated"
              : kind === "success"
                ? "Completed"
                : "Information",
            kind === "warning" ? "pending" : kind === "info" ? "neutral" : "",
          ),
        );
        cell(row, "Actor / outcome", actor);
      }
      cell(row, "Time", timeCell(event.created_at), "admin-event-time");
      body.append(row);
    });
  }
  function renderPager(data) {
    if (!$("#page-summary")) return;
    const total = data.total;
    $("#page-summary").textContent =
      total !== undefined
        ? total
          ? "Page " + pageNumber + " · " + total + " matching records"
          : "No matching records"
        : "Page " + pageNumber;
    $("#previous-page").disabled = pageNumber <= 1;
    $("#next-page").disabled =
      total !== undefined ? pageNumber * data.pageSize >= total : !data.hasMore;
  }
  let reloadRequested = false;
  async function loadCurrent(silent = false) {
    if (loading) {
      if (!silent) reloadRequested = true;
      return;
    }
    if (silent && document.querySelector("dialog[open]")) return;
    loading = true;
    try {
      if (page === "dashboard") {
        const data = await request("/api/admin/dashboard"),
          m = data.metrics;
        $$("[data-metric]").forEach((el) => {
          el.textContent = m[el.dataset.metric] ?? "—";
        });
        $$("[data-action-metric]").forEach((link) =>
          link.classList.toggle(
            "is-zero",
            Number(m[link.dataset.actionMetric]) === 0,
          ),
        );
        $("#requests-metric").classList.toggle(
          "has-items",
          Number(m.pendingRequests) > 0,
        );
        if (adminAccount?.role === "super_admin")
          setRequestBadge(Number(m.pendingRequests) || 0);
        const percent = m.active ? Math.round((m.ready / m.active) * 100) : 0;
        $("#readiness-progress").value = percent;
        $("#readiness-summary").textContent =
          m.ready +
          " of " +
          m.active +
          " active students have acknowledged policies, connected an authenticator, and have unused backup codes.";
        $("#readiness-percent").textContent = percent + "%";
        renderEvents($("#dashboard-events"), data.recent);
        pageState(
          "Updated " +
            formatTime(data.refreshedAt) +
            " · checks for updates every minute",
        );
      } else if (page === "students") {
        const params = new URLSearchParams({
          search: $("#student-search").value.trim(),
          format: "compact",
          filter: chipValue("student-filter"),
          page: pageNumber,
        });
        const data = await request("/api/admin/students?" + params);
        updateRequestBadge(data);
        students = data.students;
        renderStudents();
        renderPager(data);
        pageState(
          "Updated " +
            formatTime(data.refreshedAt) +
            " · " +
            data.students.length +
            " " +
            (data.students.length === 1 ? "student" : "students") +
            " on this page",
        );
      } else if (page === "audit") {
        const params = new URLSearchParams({
          search: $("#audit-search").value.trim(),
          format: "compact",
          category: chipValue("audit-category"),
          page: pageNumber,
        });
        const data = await request("/api/admin/audit?" + params);
        updateRequestBadge(data);
        lastEvents = data.events;
        $("#export-audit").disabled = !lastEvents.length;
        renderEvents($("#audit-rows"), data.events, true);
        renderPager(data);
        pageState(
          "Updated " + formatTime(data.refreshedAt) + " · read-only history",
        );
      } else if (page === "recovery") {
        const params = new URLSearchParams({
          number: $("#request-number").value.trim(),
          status: chipValue("request-status"),
          page: pageNumber,
        });
        if (params.get("number") && !/^\d{7}$/.test(params.get("number"))) {
          pageState("Enter all 7 digits to search, or clear the search.");
          return;
        }
        const data = await request(
          "/.netlify/functions/admin-recovery?" + params,
        );
        updateRequestBadge(data);
        const body = $("#request-rows");
        body.replaceChildren();
        if (!data.requests.length)
          emptyRow(
            body,
            4,
            "No requests in this view. Try another status or student number.",
          );
        data.requests.forEach((item) => {
          const row = node("tr", undefined, "is-clickable");
          const identity = node("div");
          identity.append(
            node("strong", item.student_number),
            node("small", "Request " + item.id.slice(0, 8), "admin-subtext"),
          );
          cell(row, "Student number", identity);
          cell(
            row,
            "Status",
            badge(
              labelEvent(item.status),
              requestTones[item.status] ?? "neutral",
            ),
          );
          const submitted = node("div", formatTime(item.created_at));
          if (["pending", "reviewing"].includes(item.status)) {
            const age = node("span", waitingLabel(item.created_at), "age-chip");
            const hours =
              (Date.now() - new Date(item.created_at).getTime()) / 3600000;
            age.classList.toggle("is-old", hours >= 48);
            submitted.append(document.createElement("br"), age);
          }
          cell(row, "Submitted", submitted);
          cell(
            row,
            "Action",
            action(
              "Review",
              () => openRequest(item.id),
              true,
              "Review request from student " + item.student_number,
            ),
          );
          row.addEventListener("click", (event) => {
            if (event.target.closest("button, a, summary")) return;
            if (String(window.getSelection?.() || "")) return;
            openRequest(item.id);
          });
          body.append(row);
        });
        renderPager(data);
        pageState(
          "Updated " +
            formatTime(data.refreshedAt) +
            " · contact claims remain unverified",
        );
      }
      refreshScheduler?.fresh();
      return true;
    } catch (error) {
      if (error.status === 401)
        return location.replace("login.html?session=expired");
      pageState(
        error.message +
          " Existing data, if shown, may be out of date. Use Refresh to retry.",
        true,
      );
      return false;
    } finally {
      loading = false;
      if (reloadRequested) {
        reloadRequested = false;
        loadCurrent();
      }
    }
  }
  function detailState(tone, text) {
    return node("span", text, "detail-state " + tone);
  }
  async function openStudent(id) {
    try {
      const { student } = await request(
        "/api/admin/students?id=" + encodeURIComponent(id),
      );
      selectedStudent = student;
      $("#student-view-title").textContent =
        student.first_name + " " + student.last_name;
      $("#student-view-subtitle").textContent =
        student.student_number + " · " + studentStatus(student)[0];
      const details = $("#student-details");
      details.replaceChildren();
      const codes = Number(student.backup_codes_remaining) || 0;
      for (const [label, value] of [
        ["Email", student.email],
        [
          "Birthday",
          student.birth_date
            ? readableDate(student.birth_date)
            : "Not recorded — do not guess",
        ],
        ["Program", student.program],
        ["Year level", student.year_level],
        [
          "Terms & privacy",
          student.policies_accepted
            ? detailState(
                "ok",
                "Acknowledged " + formatTime(student.policies_accepted_at),
              )
            : detailState("warn", "Student must review at next sign-in"),
        ],
        [
          "Authenticator",
          student.authenticator_enabled
            ? detailState("ok", "Connected")
            : detailState("warn", "Not connected"),
        ],
        [
          "Backup codes",
          detailState(
            !student.authenticator_enabled ? "off" : codes > 2 ? "ok" : "warn",
            codes + " unused — codes are private",
          ),
        ],
        [
          "Recovery phone",
          student.phone_verified
            ? detailState("ok", "Verified by student — number kept private")
            : detailState("off", "Not verified — optional, managed by student"),
        ],
        [
          "Invitation",
          student.must_change_password
            ? student.invitation_expired
              ? detailState("warn", "Expired — reissue invitation")
              : detailState(
                  "off",
                  "Expires " +
                    formatTime(student.temporary_password_expires_at),
                )
            : detailState("ok", "Personal password created"),
        ],
      ]) {
        const dd = node("dd");
        if (value instanceof Node) dd.append(value);
        else dd.textContent = value ?? "—";
        details.append(node("dt", label), dd);
      }
      $("#student-activity-link").href =
        "audit.html?search=" + encodeURIComponent(student.student_number);
      $("#student-view-edit").hidden = adminAccount.role !== "super_admin";
      const credential = $("#student-credential");
      credential.hidden = adminAccount.role !== "super_admin";
      credential.textContent = student.must_change_password
        ? "Reissue invitation email"
        : "Send reset email";
      credential.disabled =
        !student.active ||
        (!student.must_change_password && !student.phone_verified);
      $("#credential-help").textContent = student.must_change_password
        ? "The invitation contains a 24-hour temporary password. Reissuing invalidates the previous temporary password."
        : student.phone_verified
          ? "Email recovery also requires the student's verified phone. This does not reset their password immediately."
          : "Email + SMS reset needs a verified phone. The student can use their saved backup code + authenticator, or request reviewed assistance. Do not issue a new temporary password to bypass established security.";
      $("#student-view").showModal();
    } catch (error) {
      showToast(error.message, true);
    }
  }
  function renderStudents() {
    const body = $("#student-rows");
    body.replaceChildren();
    if (!students.length)
      return emptyRow(
        body,
        5,
        "No matching students. Try another filter or clear the search.",
      );
    students.forEach((student) => {
      const row = node("tr", undefined, "is-clickable"),
        person = node("div");
      person.append(
        node("strong", student.first_name + " " + student.last_name),
        node("small", student.student_number, "admin-subtext"),
      );
      cell(row, "Student", person);
      cell(row, "Email", student.email);
      const program = node("span");
      const short = programShort[student.program];
      if (short) {
        const abbr = node("abbr", short, "program-short");
        abbr.title = student.program;
        program.append(abbr);
      } else program.append(node("span", student.program));
      program.append(document.createTextNode(" · " + student.year_level));
      cell(row, "Program", program);
      const summary = node("div");
      const [label, tone] = studentStatus(student);
      summary.append(badge(label, tone));
      summary.append(
        node(
          "small",
          (student.authenticator_enabled
            ? "App connected"
            : "No authenticator") +
            " · " +
            student.backup_codes_remaining +
            " backup codes",
          "admin-subtext",
        ),
      );
      cell(row, "Security", summary);
      cell(
        row,
        "Action",
        action(
          "View",
          () => openStudent(student.id),
          true,
          "View " + student.first_name + " " + student.last_name,
        ),
      );
      row.addEventListener("click", (event) => {
        if (event.target.closest("button, a")) return;
        if (String(window.getSelection?.() || "")) return;
        openStudent(student.id);
      });
      body.append(row);
    });
  }
  function editStudent(student = null) {
    $("#student-view").close();
    const form = $("#student-form");
    form.reset();
    $("#student-form-error").textContent = "";
    selectedStudent = student;
    $("#student-record-id").value = student?.id || "";
    $("#student-number").value = student?.student_number || "";
    $("#student-number").disabled = !!student;
    $("#student-email").value = student?.email || "";
    $("#student-first-name").value = student?.first_name || "";
    $("#student-last-name").value = student?.last_name || "";
    $("#student-birthday").value = student?.birth_date || "";
    $("#student-birthday").required = !student || !!student.birth_date;
    $("#student-birthday").dispatchEvent(new Event("change"));
    $("#birthday-help").textContent =
      student && !student.birth_date
        ? "No birthday is on record. Leave it blank if unknown—never guess."
        : "For student records only—not used to verify identity.";
    const select = $("#student-program");
    select.querySelector("[data-existing-program]")?.remove();
    if (
      student?.program &&
      !Array.from(select.options).some((o) => o.value === student.program)
    ) {
      const option = node("option", student.program + " (existing record)");
      option.value = student.program;
      option.dataset.existingProgram = "true";
      select.append(option);
    }
    select.value = student?.program || "";
    $("#student-year").value = student?.year_level || "";
    $("#student-active").checked = student ? student.active : true;
    $("#active-field").classList.toggle("hidden", !student);
    $("#year-field").classList.toggle("wide", !student);
    $("#student-form-notice").hidden = !!student;
    $("#student-dialog-title").textContent = student
      ? "Edit student record"
      : "Invite a student";
    $("#student-save").textContent = student
      ? "Save changes"
      : "Create account & email invitation";
    $("#student-dialog").showModal();
    (student ? $("#student-email") : $("#student-number")).focus();
  }
  function initStudents() {
    $("#add-student").hidden = adminAccount.role !== "super_admin";
    $("#add-student").addEventListener("click", () => editStudent());
    $("#student-view-edit").addEventListener("click", () =>
      editStudent(selectedStudent),
    );
    $("#student-number").addEventListener("input", (event) => {
      event.target.value = event.target.value.replace(/\D/g, "").slice(0, 7);
    });
    $("#student-credential").addEventListener("click", async (event) => {
      const student = selectedStudent,
        button = event.currentTarget;
      const inviting = student.must_change_password;
      const confirmed = await confirmDialog({
        title: inviting ? "Reissue the invitation?" : "Send a reset email?",
        message: inviting
          ? `A new temporary password will be emailed to ${student.email}. The previous temporary password stops working immediately.`
          : `An email + SMS recovery link will be sent to ${student.email}. Their password does not change until they complete it.`,
        confirmLabel: inviting ? "Reissue invitation" : "Send reset email",
      });
      if (!confirmed) return;
      setBusy(button, true, "Sending…");
      try {
        const result = await request(
          "/api/admin/" +
            (inviting ? "issue-temporary-password" : "send-reset"),
          { method: "POST", body: JSON.stringify({ studentId: student.id }) },
        );
        $("#student-view").close();
        pageState(result.message);
        showToast(result.message);
        await loadCurrent();
      } catch (error) {
        showToast(error.message, true);
      } finally {
        setBusy(button, false, "Send");
      }
    });
    $("#student-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget,
        button = $("#student-save"),
        error = $("#student-form-error");
      if (button.disabled || !form.reportValidity()) return;
      const editing = !!$("#student-record-id").value;
      const payload = {
        id: editing ? selectedStudent.id : undefined,
        recordVersion: editing ? selectedStudent.record_version : undefined,
        studentNumber: $("#student-number").value,
        email: $("#student-email").value.trim(),
        firstName: $("#student-first-name").value.trim(),
        lastName: $("#student-last-name").value.trim(),
        birthday: $("#student-birthday").value || null,
        program: $("#student-program").value,
        yearLevel: $("#student-year").value,
        active: $("#student-active").checked,
      };
      if (
        editing &&
        (payload.email !== selectedStudent.email ||
          payload.active !== selectedStudent.active)
      ) {
        const deactivating = selectedStudent.active && !payload.active;
        const confirmed = await confirmDialog({
          title: deactivating
            ? "Deactivate this account?"
            : "Save the changed email?",
          message:
            "Verify this request through your approved administrative process." +
            (deactivating
              ? " Deactivation blocks the student’s access until it is re-enabled."
              : " Future invitations and reset emails go to the new address."),
          confirmLabel: deactivating ? "Deactivate and save" : "Save changes",
          danger: deactivating,
        });
        if (!confirmed) return;
      }
      error.textContent = "";
      setBusy(button, true, "Saving…");
      try {
        const data = await request("/api/admin/students", {
          method: editing ? "PATCH" : "POST",
          body: JSON.stringify(payload),
        });
        $("#student-dialog").close();
        showToast(data.message, data.emailSent === false);
        await loadCurrent();
        pageState(data.message, data.emailSent === false);
      } catch (failure) {
        error.textContent = failure.message;
      } finally {
        setBusy(
          button,
          false,
          editing ? "Save changes" : "Create account & email invitation",
        );
      }
    });
  }
  async function openRequest(id) {
    try {
      const data = await request(
        "/.netlify/functions/admin-recovery?id=" + encodeURIComponent(id),
      );
      const r = data.request;
      selectedRequest = r;
      $("#request-title").textContent = "Student " + r.student_number;
      $("#request-reference").textContent =
        "Request " +
        r.id.slice(0, 8) +
        " · submitted " +
        formatTime(r.created_at) +
        (["pending", "reviewing"].includes(r.status)
          ? " · " + waitingLabel(r.created_at).toLowerCase()
          : "");
      $("#request-contact").textContent = r.contact;
      $("#request-message").textContent = r.message;
      const closed = ["resolved", "declined"].includes(r.status);
      $("#review-form").hidden = closed;
      $("#request-closed").hidden = !closed;
      $("#request-closed").textContent =
        "This request is " + r.status + ". Its review history is read-only.";
      $("#review-status").value = "reviewing";
      $("#resolve-option").disabled = r.status === "pending";
      $("#review-note").value = "";
      $("#review-confirm").checked = false;
      $("#review-confirm-label").hidden = true;
      $("#review-confirm").required = false;
      $("#review-error").textContent = "";
      const history = $("#review-history");
      history.replaceChildren();
      if (!data.history.length)
        history.append(
          node(
            "p",
            r.review_note || "No review recorded yet.",
            "admin-subtext",
          ),
        );
      data.history.forEach((item) => {
        const article = node("article", undefined, "review-entry");
        article.append(
          node(
            "strong",
            labelEvent(item.status) + " · " + formatTime(item.created_at),
          ),
          node("p", item.note),
        );
        history.append(article);
      });
      $("#request-dialog").showModal();
    } catch (error) {
      showToast(error.message, true);
    }
  }
  function initRecovery() {
    $("#request-number").addEventListener("input", (event) => {
      event.target.value = event.target.value.replace(/\D/g, "").slice(0, 7);
    });
    $("#review-status").addEventListener("change", () => {
      const resolving = $("#review-status").value === "resolved";
      $("#review-confirm-label").hidden = !resolving;
      $("#review-confirm").required = resolving;
    });
    $("#review-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = $("#review-save");
      if (button.disabled || !event.currentTarget.reportValidity()) return;
      setBusy(button, true, "Saving review…");
      $("#review-error").textContent = "";
      try {
        const data = await request("/.netlify/functions/admin-recovery", {
          method: "POST",
          body: JSON.stringify({
            id: selectedRequest.id,
            status: $("#review-status").value,
            note: $("#review-note").value,
            expectedUpdatedAt: selectedRequest.updated_at,
            confirmed: $("#review-confirm").checked,
          }),
        });
        $("#request-dialog").close();
        showToast(data.message);
        await loadCurrent();
        pageState(data.message);
      } catch (error) {
        $("#review-error").textContent = error.message;
      } finally {
        setBusy(button, false, "Save review");
      }
    });
  }

  function csvCell(value) {
    let text = String(value ?? "");
    // Prevent spreadsheet formula execution from exported values.
    if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  }
  function initAudit() {
    const search = $("#audit-search");
    search.value = new URLSearchParams(location.search).get("search") || "";
    const syncQuick = () => {
      const value = search.value.trim();
      $$("#audit-quick .filter-chip").forEach((chip) =>
        chip.setAttribute(
          "aria-pressed",
          String(chip.dataset.search === value),
        ),
      );
    };
    syncQuick();
    search.addEventListener("input", syncQuick);
    $("#audit-quick").addEventListener("click", (event) => {
      const chip = event.target.closest(".filter-chip");
      if (!chip) return;
      const active = chip.getAttribute("aria-pressed") === "true";
      search.value = active ? "" : chip.dataset.search;
      syncQuick();
      pageNumber = 1;
      loadCurrent();
    });
    $("#export-audit").disabled = true;
    $("#export-audit").addEventListener("click", () => {
      if (!lastEvents.length) return;
      const header = [
        "Time (ISO)",
        "Time (local)",
        "Activity",
        "Event type",
        "Student name",
        "Student number",
        "Source",
        "Actor",
        "Reference",
      ];
      const rows = lastEvents.map((event) => [
        event.created_at,
        formatTime(event.created_at),
        describeEvent(event)[0],
        event.event_type,
        event.student_name || "",
        event.student_number || "",
        event.source,
        event.actor,
        event.id,
      ]);
      const csv = [header, ...rows]
        .map((row) => row.map(csvCell).join(","))
        .join("\r\n");
      const url = URL.createObjectURL(
        new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `audit-log-page-${pageNumber}.csv`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      showToast(`Exported ${rows.length} events from page ${pageNumber}.`);
    });
  }

  if (page === "login") {
    initLogin();
    return;
  }
  $("#admin-sign-out")?.addEventListener("click", async () => {
    const confirmed = await confirmDialog({
      title: "Sign out of administration?",
      message: "A student session in another tab, if any, stays signed in.",
      confirmLabel: "Sign out",
    });
    if (!confirmed) return;
    const button = $("#admin-sign-out");
    setBusy(button, true, "Signing out…");
    try {
      await request("/api/admin/logout", { method: "POST", body: "{}" });
      location.replace("login.html?signedOut=1");
    } catch (error) {
      showToast(error.message, true);
      setBusy(button, false, "Sign out");
    }
  });
  $$("[data-close]").forEach((button) =>
    button.addEventListener("click", () =>
      document.getElementById(button.dataset.close).close(),
    ),
  );
  $$("[data-close-dialog]").forEach((button) =>
    button.addEventListener("click", () => $("#student-dialog").close()),
  );
  requireSession().then((admin) => {
    if (!admin) return;
    adminAccount = admin;
    renderIdentity(admin);
    if (page === "recovery" && admin.role !== "super_admin") {
      pageState(
        "Recovery reviews are available to super administrators only.",
        true,
      );
      return;
    }
    if (page === "students") {
      setChip(
        "student-filter",
        new URLSearchParams(location.search).get("filter") || "",
      );
      initStudents();
    }
    if (page === "audit") initAudit();
    if (page === "recovery") initRecovery();
    $("#refresh-page").addEventListener("click", () => loadCurrent());
    $("#previous-page")?.addEventListener("click", () => {
      pageNumber = Math.max(1, pageNumber - 1);
      loadCurrent();
    });
    $("#next-page")?.addEventListener("click", () => {
      pageNumber++;
      loadCurrent();
    });
    bindChips(() => {
      pageNumber = 1;
      loadCurrent();
    });
    let searchTimer = 0;
    $$("[data-filter]").forEach((input) =>
      input.addEventListener("input", () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
          pageNumber = 1;
          loadCurrent();
        }, 350);
      }),
    );
    loadCurrent();
    scheduleRefresh(loadCurrent);
  });
})();
