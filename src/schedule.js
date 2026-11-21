// Shared by the service worker and settings page. All times use the local clock.
const RuleSchedule = (() => {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  function minutes(value) {
    if (!/^\d{2}:\d{2}$/.test(value || "")) return null;
    const [h, m] = value.split(":").map(Number);
    return h < 24 && m < 60 ? h * 60 + m : null;
  }

  function selected(rule, date) {
    // Empty days in older rules meant every day.
    return !rule.days?.length || rule.days.includes(days[date.getDay()]);
  }

  function applies(rule, now) {
    if (rule.timeWindow?.mode !== "custom") return selected(rule, now);
    const start = minutes(rule.timeWindow.start);
    const end = minutes(rule.timeWindow.end);
    if (start === null || end === null || start === end) return selected(rule, now);
    const current = now.getHours() * 60 + now.getMinutes();
    if (start < end) return selected(rule, now) && current >= start && current < end;
    // An overnight window belongs to the day on which it starts.
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    return (selected(rule, now) && current >= start)
      || (selected(rule, yesterday) && current < end);
  }

  function boundaries(rules, now) {
    const result = new Set();
    for (const rule of rules) {
      let start = minutes(rule.timeWindow?.start);
      let end = minutes(rule.timeWindow?.end);
      if (rule.timeWindow?.mode !== "custom" || start === null || end === null || start === end) {
        start = 0;
        end = 1440;
      }
      for (let offset = -1; offset <= 8; offset++) {
        const date = new Date(now);
        date.setDate(date.getDate() + offset);
        date.setHours(0, 0, 0, 0);
        if (!selected(rule, date)) continue;
        const from = new Date(date);
        from.setHours(Math.floor(start / 60), start % 60, 0, 0);
        const to = new Date(date);
        if (end <= start) to.setDate(to.getDate() + 1);
        to.setHours(Math.floor(end / 60), end % 60, 0, 0);
        for (const time of [from.getTime(), to.getTime()]) {
          if (time > now.getTime()) result.add(time);
        }
      }
    }
    return [...result].sort((a, b) => a - b);
  }

  function availableAt(rules, now) {
    // Evaluate the union, so adjacent or overlapping blocks never promise early access.
    const time = boundaries(rules, now).find(time =>
      !rules.some(rule => applies(rule, new Date(time)))
    );
    return time === undefined ? null : new Date(time).toISOString();
  }

  return { applies, boundaries, availableAt, minutes };
})();

if (typeof module !== "undefined") module.exports = RuleSchedule;
