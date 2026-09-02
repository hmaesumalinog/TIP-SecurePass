(function () {
  "use strict";

  const page = document.body.dataset.adminPage;
  let csrfToken = "";
  let students = [];
  let refreshTimer = 0;
  const $ = (selector, parent = document) => parent.querySelector(selector);

  async function request(url, options = {}) {
    const headers = new Headers(options.headers || {});
    headers.set("Accept", "application/json");
    if (options.body) headers.set("Content-Type", "application/json");
    if (csrfToken && options.method && options.method !== "GET")
      headers.set("X-Admin-CSRF", csrfToken);
    let response;
    try {
      response = await fetch(url, { ...options, headers });
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
      4200,
    );
  }

  function formatTime(value) {
    if (!value) return "—";
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  }

  function labelEvent(value) {
    return String(value || "")
      .replaceAll("_", " ")
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
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

  async function signOut() {
    const button = $("#admin-sign-out");
    setBusy(button, true, "Signing out…");
    try {
      await request("/api/admin/logout", { method: "POST", body: "{}" });
    } finally {
      window.location.replace("login.html?signedOut=1");
    }
  }

  function scheduleRefresh(callback) {
    window.clearInterval(refreshTimer);
    refreshTimer = window.setInterval(() => {
      if (!document.hidden) callback(true);
    }, 8000);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) callback(true);
    });
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
      if (!email.validity.valid || !password.value) {
        error.textContent =
          "Enter the authorized administrator email and password.";
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

  async function loadDashboard(silent = false) {
    try {
      const data = await request("/api/admin/dashboard");
      $("#metric-students").textContent = data.metrics.students;
      $("#metric-active").textContent = data.metrics.active;
      $("#metric-resets").textContent = data.metrics.resets;
      $("#metric-failures").textContent = data.metrics.failures;
      $("#dashboard-updated").textContent =
        `Updated ${formatTime(data.refreshedAt)}`;
      const body = $("#dashboard-events");
      body.replaceChildren();
      if (!data.recent.length) {
        const row = document.createElement("tr");
        cell(row, "", "No security activity has been recorded.", "admin-empty");
        body.append(row);
        return;
      }
      data.recent.forEach((event) => {
        const row = document.createElement("tr");
        cell(row, "Event", labelEvent(event.event_type), "admin-event-name");
        cell(
          row,
          "Category",
          event.source === "admin" ? "Administration" : "Student security",
        );
        cell(row, "Time", formatTime(event.created_at), "admin-event-time");
        body.append(row);
      });
    } catch (error) {
      if (!silent) showToast(error.message, true);
    }
  }

  function studentPayload() {
    return {
      id: $("#student-record-id").value || undefined,
      studentNumber: $("#student-number").value,
      email: $("#student-email").value.trim(),
      firstName: $("#student-first-name").value.trim(),
      lastName: $("#student-last-name").value.trim(),
      age: Number($("#student-age").value),
      phone: $("#student-phone").value.trim(),
      program: $("#student-program").value.trim(),
      yearLevel: $("#student-year").value,
      active: $("#student-active").checked,
    };
  }

  function selectStudentProgram(program = "") {
    const select = $("#student-program");
    select.querySelector("[data-existing-program]")?.remove();
    const value = String(program).trim();
    if (
      value &&
      !Array.from(select.options).some((option) => option.value === value)
    ) {
      const existing = document.createElement("option");
      existing.value = value;
      existing.textContent = `${value} (existing record)`;
      existing.dataset.existingProgram = "true";
      select.append(existing);
    }
    select.value = value;
  }

  function openStudent(student = null) {
    const dialog = $("#student-dialog");
    $("#student-form").reset();
    $("#student-form-error").textContent = "";
    $("#student-record-id").value = student?.id || "";
    $("#student-number").value = student?.student_number || "";
    $("#student-number").disabled = Boolean(student);
    $("#student-email").value = student?.email || "";
    $("#student-first-name").value = student?.first_name || "";
    $("#student-last-name").value = student?.last_name || "";
    $("#student-age").value = student?.age || "";
    $("#student-phone").value = student?.phone || "";
    selectStudentProgram(student?.program || "");
    $("#student-year").value = student?.year_level || "4th Year";
    $("#student-active").checked = student ? student.active : true;
    $("#active-field").classList.toggle("hidden", !student);
    $("#student-dialog-title").textContent = student
      ? `Edit ${student.student_number}`
      : "Add student";
    $('button[type="submit"]', $("#student-form")).textContent = student
      ? "Save changes"
      : "Save and email temporary password";
    dialog.showModal();
  }

  async function sendReset(student, button) {
    if (
      !window.confirm(`Send a secure password-reset link to ${student.email}?`)
    )
      return;
    setBusy(button, true, "Sending…");
    try {
      const data = await request("/api/admin/send-reset", {
        method: "POST",
        body: JSON.stringify({ studentId: student.id }),
      });
      showToast(data.message);
    } catch (error) {
      showToast(error.message, true);
    } finally {
      setBusy(button, false, "Send reset link");
    }
  }

  async function issueTemporaryPassword(student, button) {
    if (
      !window.confirm(
        `Create a new temporary password and email it to ${student.email}? Any current password for this student will stop working.`,
      )
    )
      return;
    setBusy(button, true, "Issuing…");
    try {
      const data = await request("/api/admin/issue-temporary-password", {
        method: "POST",
        body: JSON.stringify({ studentId: student.id }),
      });
      showToast(data.message);
      await loadStudents(true);
    } catch (error) {
      showToast(error.message, true);
    } finally {
      setBusy(button, false, "Reissue temporary password");
    }
  }

  function renderStudents() {
    const body = $("#student-rows");
    body.replaceChildren();
    if (!students.length) {
      const row = document.createElement("tr");
      cell(row, "", "No matching students found.", "admin-empty");
      body.append(row);
      return;
    }
    students.forEach((student) => {
      const row = document.createElement("tr");
      const person = document.createElement("span");
      const name = document.createElement("strong");
      name.textContent = `${student.first_name} ${student.last_name}`;
      const number = document.createElement("small");
      number.textContent = student.student_number;
      person.append(name, document.createElement("br"), number);
      cell(row, "Student", person);
      cell(row, "Email", student.email);
      cell(row, "Program", `${student.program} · ${student.year_level}`);
      const setupPending = student.active && student.must_change_password;
      const status = document.createElement("span");
      status.className = `admin-status${!student.active ? " inactive" : setupPending ? " pending" : ""}`;
      status.textContent = !student.active
        ? "Inactive"
        : setupPending
          ? "Setup pending"
          : "Active";
      cell(row, "Status", status);
      const actions = document.createElement("div");
      actions.className = "admin-actions";
      const edit = document.createElement("button");
      edit.className = "admin-button secondary small";
      edit.type = "button";
      edit.textContent = "Edit";
      edit.addEventListener("click", () => openStudent(student));
      const credential = document.createElement("button");
      credential.className = "admin-button small";
      credential.type = "button";
      credential.textContent = setupPending
        ? "Reissue temporary password"
        : "Send reset link";
      credential.disabled = !student.active;
      credential.addEventListener("click", () =>
        setupPending
          ? issueTemporaryPassword(student, credential)
          : sendReset(student, credential),
      );
      actions.append(edit, credential);
      cell(row, "Actions", actions);
      body.append(row);
    });
  }

  async function loadStudents(silent = false) {
    try {
      const search = $("#student-search").value.trim();
      const data = await request(
        `/api/admin/students${search ? `?search=${encodeURIComponent(search)}` : ""}`,
      );
      students = data.students;
      renderStudents();
      $("#students-updated").textContent =
        `${students.length} shown · ${formatTime(data.refreshedAt)}`;
    } catch (error) {
      if (!silent) showToast(error.message, true);
    }
  }

  function initStudents() {
    let searchTimer = 0;
    $("#add-student").addEventListener("click", () => openStudent());
    document
      .querySelectorAll("[data-close-dialog]")
      .forEach((button) =>
        button.addEventListener("click", () => $("#student-dialog").close()),
      );
    $("#student-number").addEventListener("input", (event) => {
      event.target.value = event.target.value.replace(/\D/g, "").slice(0, 7);
    });
    $("#student-search").addEventListener("input", () => {
      window.clearTimeout(searchTimer);
      searchTimer = window.setTimeout(() => loadStudents(), 250);
    });
    $("#student-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const button = $('button[type="submit"]', form);
      const error = $("#student-form-error");
      const payload = studentPayload();
      error.textContent = "";
      if (!form.reportValidity()) return;
      setBusy(button, true, "Saving…");
      try {
        const editing = Boolean(payload.id);
        const data = await request("/api/admin/students", {
          method: editing ? "PATCH" : "POST",
          body: JSON.stringify(payload),
        });
        $("#student-dialog").close();
        showToast(data.message, !editing && data.emailSent === false);
        await loadStudents();
      } catch (saveError) {
        error.textContent = saveError.message;
      } finally {
        setBusy(
          button,
          false,
          editing ? "Save changes" : "Save and email temporary password",
        );
      }
    });
  }

  async function loadAudit(silent = false) {
    try {
      const data = await request("/api/admin/audit");
      $("#audit-updated").textContent =
        `Updated ${formatTime(data.refreshedAt)}`;
      const body = $("#audit-rows");
      body.replaceChildren();
      if (!data.events.length) {
        const row = document.createElement("tr");
        cell(row, "", "No audit events have been recorded.", "admin-empty");
        body.append(row);
        return;
      }
      data.events.forEach((event) => {
        const row = document.createElement("tr");
        cell(row, "Event", labelEvent(event.event_type), "admin-event-name");
        cell(row, "Category", event.category);
        cell(
          row,
          "Student record",
          event.student_id ? `${event.student_id.slice(0, 8)}…` : "—",
        );
        cell(row, "Time", formatTime(event.created_at), "admin-event-time");
        body.append(row);
      });
    } catch (error) {
      if (!silent) showToast(error.message, true);
    }
  }

  if (page === "login") {
    initLogin();
    return;
  }
  $("#admin-sign-out")?.addEventListener("click", signOut);
  requireSession().then((admin) => {
    if (!admin) return;
    if (page === "dashboard") {
      loadDashboard();
      scheduleRefresh(loadDashboard);
    }
    if (page === "students") {
      initStudents();
      loadStudents();
      scheduleRefresh(loadStudents);
    }
    if (page === "audit") {
      loadAudit();
      scheduleRefresh(loadAudit);
    }
  });
})();
