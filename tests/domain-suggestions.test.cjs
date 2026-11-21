const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load, domainForUrl } = require('../src/domain-suggestions.js');
const now = new Date('2026-11-21T18:00:00Z').getTime();
const week = 7 * 24 * 60 * 60 * 1000;

test('counts only visits within the rolling week, merging paths and www without using lifetime visitCount', async () => {
  let query;
  const urls = ['https://www.reddit.com/a', 'https://reddit.com/b', 'https://example.com/', 'chrome://settings'];
  const history = {
    search: async q => { query = q; return urls.map(url => ({ url, visitCount: 99999 })); },
    getVisits: async ({ url }) => url.includes('example.com')
      ? [{ visitTime: now }, { visitTime: now + 1 }, { visitTime: now - week - 1 }]
      : [{ visitTime: now - week }, { visitTime: now - 10 }, { visitTime: now - 5, transition: 'auto_subframe' }]
  };
  const result = await load(history, { now });
  assert.deepEqual(result.domains, [{ domain: 'reddit.com', count: 4 }, { domain: 'example.com', count: 1 }]);
  assert.equal(query.startTime, now - week);
  assert.equal(query.endTime, now);
  assert.equal(result.truncated, false);
});

test('handles empty history, invalid URLs, separate subdomains and duplicate URLs', async () => {
  assert.equal(domainForUrl('not a url'), null);
  assert.equal(domainForUrl('file:///tmp/private.html'), null);
  assert.equal(domainForUrl('https://forum.reddit.com/path'), 'forum.reddit.com');
  assert.deepEqual((await load({ search: async () => [] }, { now })).domains, []);
  let calls = 0;
  const result = await load({ search: async () => [{ url: 'https://example.com' }, { url: 'https://example.com' }], getVisits: async () => { calls++; return [{ visitTime: now }]; } }, { now });
  assert.equal(calls, 1);
  assert.equal(result.domains[0].count, 1);
});

test('marks capped history results as partial and propagates permission failures', async () => {
  const result = await load({ search: async () => [{ url: 'https://example.com' }], getVisits: async () => [{ visitTime: now, transition: 'reload' }] }, { now, maxResults: 1 });
  assert.equal(result.truncated, true);
  assert.equal(result.domains[0].count, 1);
  await assert.rejects(load({ search: async () => { throw new Error('permission denied'); } }, { now }), /permission denied/);
  await assert.rejects(load({ search: async () => [{ url: 'https://example.com' }], getVisits: async () => { throw new Error('access revoked'); } }, { now }), /access revoked/);
});

test('bounds parallel history calls for large inputs', async () => {
  let running = 0;
  let peak = 0;
  await load({ search: async () => Array.from({ length: 30 }, (_, i) => ({ url: `https://example.com/${i}` })), getVisits: async () => { peak = Math.max(peak, ++running); await new Promise(resolve => setImmediate(resolve)); running--; return [{ visitTime: now }]; } }, { now });
  assert.ok(peak <= 8);
});
