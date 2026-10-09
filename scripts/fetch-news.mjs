// settings.yml で選んだジャンルのフィードとマーケット指標を取得し、public/data/*.json を生成する。
// GitHub Actions から定期実行される（ローカルでは `npm run fetch`）。
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXCLUDE_KEYWORDS, FEEDS, GAMES_EXCLUDE_KEYWORDS, GENRES, LIMITS, MARKETS, TOPICS } from '../config/feeds.mjs';
import { compileKeywords, dedupeAndSort, normalizeItems, parseFeed, parseQuote } from './lib.mjs';
import { loadSettings, settingsUrls } from './settings.mjs';

const settings = await loadSettings();
const genres = GENRES.filter((g) => settings.genres.includes(g.id));
const feeds = FEEDS.filter((f) => settings.genres.includes(f.category));
const EXCLUDE_LISTS = { common: EXCLUDE_KEYWORDS, games: GAMES_EXCLUDE_KEYWORDS };

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'public', 'data');
const UA = 'Mozilla/5.0 (compatible; NewsAppBot/1.0; +https://github.com/YoutaAsano/NewsApp)';

async function fetchText(url, accept) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: accept },
    signal: AbortSignal.timeout(LIMITS.fetchTimeoutMs),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

async function fetchFeeds() {
  // ジャンルごとに除外キーワードを切り替える（ゲーム業界では「eスポーツ」等を除外しない）
  const excluders = Object.fromEntries(genres.map((g) => [g.id, compileKeywords(EXCLUDE_LISTS[g.exclude] ?? [])]));
  const now = Date.now();
  const results = await Promise.allSettled(
    feeds.map(async (feed) => {
      const xml = await fetchText(feed.url, 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*');
      const parsed = parseFeed(xml);
      return normalizeItems(parsed.items, feed, { topics: TOPICS, isExcluded: excluders[feed.category], limits: LIMITS, now });
    }),
  );

  const items = [];
  const sources = results.map((r, i) => {
    const feed = feeds[i];
    if (r.status === 'fulfilled') {
      items.push(...r.value);
      console.log(`✓ ${feed.name}: ${r.value.length} 件`);
      return { name: feed.name, category: feed.category, lang: feed.lang, ok: true, count: r.value.length };
    }
    console.warn(`✗ ${feed.name}: ${r.reason?.message ?? r.reason}`);
    return { name: feed.name, category: feed.category, lang: feed.lang, ok: false, error: String(r.reason?.message ?? r.reason) };
  });

  return { items: dedupeAndSort(items, LIMITS.maxItems), sources };
}

async function fetchMarkets() {
  const results = await Promise.allSettled(
    MARKETS.map(async (m) => {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(m.symbol)}?range=1d&interval=1d`;
      const quote = parseQuote(JSON.parse(await fetchText(url, 'application/json')));
      if (!quote) throw new Error('no quote');
      return { ...m, ...quote };
    }),
  );
  return results.flatMap((r, i) => {
    if (r.status === 'fulfilled') return [r.value];
    console.warn(`✗ market ${MARKETS[i].symbol}: ${r.reason?.message ?? r.reason}`);
    return [];
  });
}

const [news, markets] = await Promise.all([fetchFeeds(), fetchMarkets()]);
const generatedAt = new Date().toISOString();

await mkdir(OUT_DIR, { recursive: true });
await writeFile(
  join(OUT_DIR, 'news.json'),
  JSON.stringify({
    generatedAt,
    categories: genres.map(({ id, label }) => ({ id, label })),
    settings: {
      genres: settings.genres,
      available: GENRES.map(({ id, label }) => ({ id, label })),
      digests: settings.digests.map(({ id, name, genres, label, prompt }) => ({ id, name, genres, label, prompt })),
      urls: settingsUrls(),
    },
    topics: TOPICS.map(({ id, label }) => ({ id, label })),
    sources: news.sources,
    items: news.items,
  }),
);
await writeFile(join(OUT_DIR, 'markets.json'), JSON.stringify({ generatedAt, quotes: markets }));

const okCount = news.sources.filter((s) => s.ok).length;
console.log(`\n記事 ${news.items.length} 件 / フィード ${okCount}/${feeds.length} 成功 / 指標 ${markets.length}/${MARKETS.length}`);

if (okCount === 0) {
  console.error('すべてのフィードの取得に失敗しました');
  process.exit(1);
}
