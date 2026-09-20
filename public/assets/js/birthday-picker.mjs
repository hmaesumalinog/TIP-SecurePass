// Progressive enhancement: the native date field remains the form's ISO value.
const MONTHS = Array.from({ length: 12 }, (_, month) =>
  new Intl.DateTimeFormat("en", { month: "long", timeZone: "UTC" }).format(
    new Date(Date.UTC(2000, month, 1)),
  ),
);
const formatDate = new Intl.DateTimeFormat("en", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
export const isoDate = (date) => date.toISOString().slice(0, 10);
export function parseDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && isoDate(date) === value
    ? date
    : null;
}
export function dateInMonth(year, month, day) {
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(day, last)));
}
export function birthdayBounds(now = new Date()) {
  const year = now.getUTCFullYear(),
    month = now.getUTCMonth(),
    day = now.getUTCDate();
  const min = dateInMonth(year - 101, month, day);
  min.setUTCDate(min.getUTCDate() + 1);
  return { min, max: dateInMonth(year - 15, month, day) };
}
export function calendarDays(year, month) {
  const first = new Date(Date.UTC(year, month, 1));
  first.setUTCDate(first.getUTCDate() - first.getUTCDay());
  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(first);
    day.setUTCDate(day.getUTCDate() + index);
    return day;
  });
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text) node.textContent = text;
  return node;
}
function button(className, label, text) {
  const node = element("button", className, text);
  node.type = "button";
  node.setAttribute("aria-label", label);
  return node;
}

export function enhanceBirthdayPicker(input) {
  const { min, max } = birthdayBounds();
  const clamp = (date) => new Date(Math.min(max, Math.max(min, date)));
  const wrapper = element("div", "birthday-picker");
  const trigger = button("birthday-trigger", "Choose birthday");
  trigger.id = `${input.id}-trigger`;
  trigger.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 11h18M7 15h2m2 0h2m2 0h2m-10 3h2m2 0h2"/></svg>';
  const value = element("span", "birthday-value", "Choose a date");
  const hint = element("span", "birthday-trigger-hint", "Select");
  trigger.append(value, hint);
  const panel = element("section", "birthday-panel");
  panel.id = `${input.id}-calendar`;
  panel.hidden = true;
  panel.setAttribute("aria-label", "Choose a birthday");
  trigger.setAttribute("aria-controls", panel.id);
  trigger.setAttribute("aria-expanded", "false");
  const error = element("p", "birthday-error");
  error.id = `${input.id}-error`;
  error.hidden = true;
  error.setAttribute("role", "alert");
  trigger.setAttribute(
    "aria-describedby",
    `${input.getAttribute("aria-describedby") || ""} ${error.id}`.trim(),
  );
  const intro = element("div", "birthday-intro");
  intro.append(
    element("strong", "", "Choose a birthday"),
    element("span", "", "Select the year, month, then day."),
  );
  const close = button("birthday-icon-button", "Close calendar", "×");
  intro.append(close);
  const controls = element("div", "birthday-controls");
  const previous = button("birthday-icon-button", "Previous month", "‹");
  const next = button("birthday-icon-button", "Next month", "›");
  const month = element("select", "birthday-select");
  month.setAttribute("aria-label", "Birth month");
  const year = element("select", "birthday-select");
  year.setAttribute("aria-label", "Birth year");
  MONTHS.forEach((name, index) => month.add(new Option(name, String(index))));
  for (
    let current = max.getUTCFullYear();
    current >= min.getUTCFullYear();
    current--
  )
    year.add(new Option(String(current), String(current)));
  controls.append(previous, month, year, next);
  const grid = element("div", "birthday-grid");
  grid.setAttribute("role", "grid");
  const liveMonth = element("span", "sr-only");
  liveMonth.setAttribute("aria-live", "polite");
  const footer = element("div", "birthday-footer");
  const selection = element("span", "birthday-selection");
  const clear = button("birthday-clear", "Clear birthday", "Clear");
  footer.append(selection, clear);
  panel.append(intro, controls, liveMonth, grid, footer);
  wrapper.append(trigger, panel, error);
  input.after(wrapper);
  input.hidden = true;
  input.min = isoDate(min);
  input.max = isoDate(max);
  const label = input.labels?.[0];
  if (label) label.htmlFor = trigger.id;
  let view, focusDate;

  function sync() {
    const selected = parseDate(input.value);
    value.textContent = selected
      ? formatDate.format(selected)
      : "Choose a date";
    hint.textContent = selected ? "Change" : "Select";
    trigger.classList.toggle("has-date", !!selected);
    trigger.setAttribute(
      "aria-label",
      selected
        ? `Birthday: ${formatDate.format(selected)}. Change date`
        : "Birthday: choose a date",
    );
    error.hidden = true;
    trigger.removeAttribute("aria-invalid");
    clear.disabled = !selected;
    const now = new Date();
    const initial =
      selected ||
      dateInMonth(
        now.getUTCFullYear() - 18,
        now.getUTCMonth(),
        now.getUTCDate(),
      );
    focusDate = clamp(initial);
    view = new Date(focusDate);
    render();
  }
  function render() {
    const y = view.getUTCFullYear(),
      m = view.getUTCMonth();
    month.value = String(m);
    year.value = String(y);
    for (const option of month.options) {
      const start = new Date(Date.UTC(y, Number(option.value), 1));
      const end = new Date(Date.UTC(y, Number(option.value) + 1, 0));
      option.disabled = end < min || start > max;
    }
    previous.disabled = new Date(Date.UTC(y, m, 0)) < min;
    next.disabled = new Date(Date.UTC(y, m + 1, 1)) > max;
    grid.setAttribute("aria-label", `${MONTHS[m]} ${y}`);
    liveMonth.textContent = `${MONTHS[m]} ${y}`;
    grid.replaceChildren();
    const headings = element("div", "birthday-week");
    headings.setAttribute("role", "row");
    [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ].forEach((name) => {
      const cell = element("span", "birthday-weekday", name.slice(0, 2));
      cell.setAttribute("role", "columnheader");
      cell.setAttribute("aria-label", name);
      headings.append(cell);
    });
    grid.append(headings);
    const days = calendarDays(y, m);
    for (let week = 0; week < 6; week++) {
      const row = element("div", "birthday-week");
      row.setAttribute("role", "row");
      for (const day of days.slice(week * 7, week * 7 + 7)) {
        const iso = isoDate(day);
        const selected = iso === input.value;
        const cell = element("div", "birthday-cell");
        cell.setAttribute("role", "gridcell");
        cell.setAttribute("aria-selected", String(selected));
        const dateButton = button(
          "birthday-day",
          formatDate.format(day),
          String(day.getUTCDate()),
        );
        dateButton.dataset.date = iso;
        dateButton.classList.toggle("is-outside", day.getUTCMonth() !== m);
        dateButton.classList.toggle("is-selected", selected);
        dateButton.disabled = day < min || day > max;
        dateButton.tabIndex = iso === isoDate(focusDate) ? 0 : -1;
        cell.append(dateButton);
        row.append(cell);
      }
      grid.append(row);
    }
    selection.textContent = input.value
      ? formatDate.format(parseDate(input.value))
      : "No date selected";
  }
  function focusDay() {
    grid.querySelector(`[data-date="${isoDate(focusDate)}"]`)?.focus();
  }
  function open() {
    // Refresh selection when another part of the form has populated the field.
    sync();
    panel.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    focusDay();
    panel.scrollIntoView({ block: "nearest" });
  }
  function hide(restoreFocus = false) {
    panel.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    if (restoreFocus) trigger.focus();
  }
  function changeView(target, focus = false) {
    focusDate = clamp(target);
    view = new Date(focusDate);
    render();
    if (focus) focusDay();
  }
  trigger.addEventListener("click", () => (panel.hidden ? open() : hide()));
  close.addEventListener("click", () => hide(true));
  previous.addEventListener("click", () =>
    changeView(
      dateInMonth(
        view.getUTCFullYear(),
        view.getUTCMonth() - 1,
        focusDate.getUTCDate(),
      ),
    ),
  );
  next.addEventListener("click", () =>
    changeView(
      dateInMonth(
        view.getUTCFullYear(),
        view.getUTCMonth() + 1,
        focusDate.getUTCDate(),
      ),
    ),
  );
  for (const select of [month, year])
    select.addEventListener("change", () =>
      changeView(
        dateInMonth(
          Number(year.value),
          Number(month.value),
          focusDate.getUTCDate(),
        ),
      ),
    );
  grid.addEventListener("click", (event) => {
    const day = event.target.closest("[data-date]");
    if (!day || day.disabled) return;
    input.value = day.dataset.date;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    hide(true);
  });
  clear.addEventListener("click", () => {
    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    hide(true);
  });
  grid.addEventListener("keydown", (event) => {
    const button = event.target.closest("[data-date]");
    if (!button) return;
    const day = parseDate(button.dataset.date);
    let target;
    const offsets = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
      Home: -day.getUTCDay(),
      End: 6 - day.getUTCDay(),
    };
    if (Object.hasOwn(offsets, event.key)) {
      target = new Date(day);
      target.setUTCDate(target.getUTCDate() + offsets[event.key]);
    } else if (["PageUp", "PageDown"].includes(event.key)) {
      target = dateInMonth(
        day.getUTCFullYear(),
        day.getUTCMonth() +
          (event.key === "PageUp" ? -1 : 1) * (event.shiftKey ? 12 : 1),
        day.getUTCDate(),
      );
    } else return;
    event.preventDefault();
    changeView(target, true);
  });
  wrapper.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !panel.hidden) {
      event.preventDefault();
      event.stopPropagation();
      hide(true);
    }
  });
  wrapper.addEventListener("focusout", (event) => {
    if (event.relatedTarget && !wrapper.contains(event.relatedTarget)) hide();
  });
  document.addEventListener("click", (event) => {
    if (!wrapper.contains(event.target)) hide();
  });
  input.addEventListener("change", sync);
  input.addEventListener("invalid", (event) => {
    event.preventDefault();
    open();
    error.textContent = input.value
      ? "Choose a birthday within the supported student age range (15–100)."
      : "Please choose the student’s birthday.";
    error.hidden = false;
    trigger.setAttribute("aria-invalid", "true");
  });
  input.form?.addEventListener("reset", () =>
    queueMicrotask(() => {
      hide();
      sync();
    }),
  );
  input.closest("dialog")?.addEventListener("close", () => hide());
  sync();
}

if (typeof document !== "undefined") {
  document
    .querySelectorAll("[data-birthday-picker]")
    .forEach(enhanceBirthdayPicker);
}
