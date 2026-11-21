// Query on demand only. Full URLs and results are never persisted by the extension.
const DomainSuggestions = (() => {
  const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

  function domainForUrl(value) {
    try {
      const url = new URL(value);
      return ["http:", "https:"].includes(url.protocol)
        ? url.hostname.toLowerCase().replace(/^www\./, "") : null;
    } catch {
      return null;
    }
  }

  async function load(history, { now = Date.now(), maxResults = 10000 } = {}) {
    const startTime = now - WEEK_MS;
    const items = await history.search({ text: "", startTime, endTime: now, maxResults });
    const urls = [...new Set(items.map(item => item.url).filter(url => domainForUrl(url)))];
    const totals = new Map();
    let cursor = 0;
    // Bound concurrency so a large history doesn't flood Chrome with API calls.
    await Promise.all(Array.from({ length: Math.min(8, urls.length) }, async () => {
      while (cursor < urls.length) {
        const url = urls[cursor++];
        const visits = await history.getVisits({ url });
        const count = visits.filter(visit =>
          visit.visitTime >= startTime && visit.visitTime <= now
          && !["auto_subframe", "manual_subframe"].includes(visit.transition)
        ).length;
        if (!count) continue;
        const domain = domainForUrl(url);
        totals.set(domain, (totals.get(domain) || 0) + count);
      }
    }));
    return {
      domains: [...totals].map(([domain, count]) => ({ domain, count }))
        .sort((a, b) => b.count - a.count || a.domain.localeCompare(b.domain)),
      truncated: items.length >= maxResults
    };
  }

  return { load, domainForUrl };
})();

if (typeof module !== "undefined") module.exports = DomainSuggestions;
