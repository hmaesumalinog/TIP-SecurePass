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
      response = await fetch(url, { ...options, headers, cache: "no-store" });
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

  function scheduleRefresh(callback) {
    window.clearInterval(refreshTimer);
    refreshTimer = window.setInterval(() => {
      if (!document.hidden) callback(true);
    }, 30000);
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

  let adminAccount,
    pageNumber = 1,
    loading = false,
    selectedStudent = null,
    selectedRequest = null;
  const statusNames = {
    invited: "Waiting for first login",
    setup: "Setup incomplete",
    ready: "Recovery ready",
    attention: "Backup codes needed",
    inactive: "Inactive",
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
  function node(tag, text, className) {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (className) element.className = className;
    return element;
  }
  function badge(text, type = "") {
    return node("span", text, "admin-status " + type);
  }
  function action(label, callback, secondary = true) {
    const button = node(
      "button",
      label,
      "admin-button small" + (secondary ? " secondary" : ""),
    );
    button.type = "button";
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
  function renderEvents(body, events, full = false) {
    body.replaceChildren();
    if (!events.length)
      return emptyRow(body, full ? 4 : 3, "No activity matches this view.");
    events.forEach((event) => {
      const row = node("tr");
      const [title, explanation, kind] = eventNames[event.event_type] || [
        labelEvent(event.event_type),
        "Recorded security activity.",
        /failed|locked|rejected/.test(event.event_type) ? "warning" : "info",
      ];
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
      cell(row, "Time", formatTime(event.created_at), "admin-event-time");
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
        document.querySelectorAll("[data-metric]").forEach((el) => {
          el.textContent = m[el.dataset.metric] ?? "—";
        });
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
            " · refreshes every 30 seconds",
        );
      } else if (page === "students") {
        const params = new URLSearchParams({
          search: $("#student-search").value.trim(),
          filter: $("#student-filter").value,
          page: pageNumber,
        });
        const data = await request("/api/admin/students?" + params);
        students = data.students;
        renderStudents();
        renderPager(data);
        pageState(
          "Updated " +
            formatTime(data.refreshedAt) +
            " · " +
            data.total +
            " matching students",
        );
      } else if (page === "audit") {
        const params = new URLSearchParams({
          search: $("#audit-search").value.trim(),
          category: $("#audit-category").value,
          page: pageNumber,
        });
        const data = await request("/api/admin/audit?" + params);
        renderEvents($("#audit-rows"), data.events, true);
        renderPager(data);
        pageState(
          "Updated " + formatTime(data.refreshedAt) + " · read-only history",
        );
      } else if (page === "recovery") {
        const params = new URLSearchParams({
          number: $("#request-number").value.trim(),
          status: $("#request-status").value,
          page: pageNumber,
        });
        if (params.get("number") && !/^\d{7}$/.test(params.get("number"))) {
          pageState("Enter all 7 digits to search, or clear the search.");
          return;
        }
        const data = await request(
          "/.netlify/functions/admin-recovery?" + params,
        );
        const body = $("#request-rows");
        body.replaceChildren();
        if (!data.requests.length)
          emptyRow(
            body,
            4,
            "No requests in this view. Try another status or student number.",
          );
        data.requests.forEach((item) => {
          const row = node("tr");
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
              item.status === "pending"
                ? "pending"
                : item.status === "declined"
                  ? "inactive"
                  : "neutral",
            ),
          );
          cell(row, "Submitted", formatTime(item.created_at));
          cell(
            row,
            "Action",
            action("Review request", () => openRequest(item.id)),
          );
          body.append(row);
        });
        renderPager(data);
        pageState(
          "Updated " +
            formatTime(data.refreshedAt) +
            " · contact claims remain unverified",
        );
      }
    } catch (error) {
      if (error.status === 401)
        return location.replace("login.html?session=expired");
      pageState(
        error.message +
          " Existing data, if shown, may be out of date. Use Refresh to retry.",
        true,
      );
    } finally {
      loading = false;
      if (reloadRequested) {
        reloadRequested = false;
        loadCurrent();
      }
    }
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
        student.student_number + " · " + statusNames[student.security_status];
      const details = $("#student-details");
      details.replaceChildren();
      for (const [label, value] of [
        ["Email", student.email],
        ["Birthday", student.birth_date || "Not recorded — do not guess"],
        ["Program", student.program],
        ["Year level", student.year_level],
        [
          "Terms & privacy",
          student.policies_accepted
            ? "Acknowledged " + formatTime(student.policies_accepted_at)
            : "Student must review at next sign-in",
        ],
        [
          "Authenticator",
          student.authenticator_enabled ? "Connected" : "Not connected",
        ],
        [
          "Backup codes",
          student.backup_codes_remaining + " unused — codes are private",
        ],
        [
          "Recovery phone",
          student.phone_verified
            ? "Verified by student — number kept private"
            : "Not verified — optional, managed by student",
        ],
        [
          "Invitation",
          student.must_change_password
            ? student.invitation_expired
              ? "Expired — reissue invitation"
              : "Expires " + formatTime(student.temporary_password_expires_at)
            : "Personal password created",
        ],
      ]) {
        details.append(node("dt", label), node("dd", value));
      }
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
        "No matching students. Clear the filters or add a student.",
      );
    students.forEach((student) => {
      const row = node("tr"),
        person = node("div");
      person.append(
        node("strong", student.first_name + " " + student.last_name),
        node("small", student.student_number, "admin-subtext"),
      );
      cell(row, "Student", person);
      cell(row, "Email", student.email);
      cell(row, "Program", student.program + " · " + student.year_level);
      const summary = node("div");
      summary.append(
        badge(
          student.invitation_expired
            ? "Invitation expired"
            : statusNames[student.security_status],
          student.security_status === "ready"
            ? ""
            : student.security_status === "inactive"
              ? "inactive"
              : "pending",
        ),
      );
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
        action("View student", () => openStudent(student.id)),
      );
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
    $("#student-dialog-title").textContent = student
      ? "Edit student record"
      : "Invite a student";
    $("#student-save").textContent = student
      ? "Save changes"
      : "Create account & email invitation";
    $("#student-dialog").showModal();
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
      if (
        !confirm(
          (inviting
            ? "Reissue an invitation to "
            : "Send an email + SMS recovery link to ") +
            student.email +
            "?" +
            (inviting
              ? " The previous temporary password will stop working."
              : ""),
        )
      )
        return;
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
          payload.active !== selectedStudent.active) &&
        !confirm(
          "Save the changed email or account status? Verify this request through your approved administrative process. Deactivation blocks student access.",
        )
      )
        return;
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
        formatTime(r.created_at);
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
  if (page === "login") {
    initLogin();
    return;
  }
  $("#admin-sign-out")?.addEventListener("click", async () => {
    if (
      !confirm(
        "Sign out of the administrator area? Your student session in another tab will stay signed in.",
      )
    )
      return;
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
  document
    .querySelectorAll("[data-close]")
    .forEach((button) =>
      button.addEventListener("click", () =>
        document.getElementById(button.dataset.close).close(),
      ),
    );
  document
    .querySelectorAll("[data-close-dialog]")
    .forEach((button) =>
      button.addEventListener("click", () => $("#student-dialog").close()),
    );
  requireSession().then((admin) => {
    if (!admin) return;
    adminAccount = admin;
    if (page === "recovery" && admin.role !== "super_admin") {
      pageState(
        "Recovery reviews are available to super administrators only.",
        true,
      );
      return;
    }
    if (page === "students") {
      $("#student-filter").value =
        new URLSearchParams(location.search).get("filter") || "";
      initStudents();
    }
    if (page === "audit")
      $("#audit-search").value =
        new URLSearchParams(location.search).get("search") || "";
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
    let searchTimer = 0;
    document.querySelectorAll("[data-filter]").forEach((input) =>
      input.addEventListener(
        input.tagName === "SELECT" ? "change" : "input",
        () => {
          clearTimeout(searchTimer);
          searchTimer = setTimeout(() => {
            pageNumber = 1;
            loadCurrent();
          }, 350);
        },
      ),
    );
    loadCurrent();
    scheduleRefresh(loadCurrent);
  });
})();
