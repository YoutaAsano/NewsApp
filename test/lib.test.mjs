import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileKeywords, dedupeAndSort, normalizeItems, parseFeed, parseQuote, stripHtml } from '../scripts/lib.mjs';
import { EXCLUDE_KEYWORDS, TOPICS } from '../config/feeds.mjs';

const NOW = Date.parse('2026-10-03T09:00:00Z');
const LIMITS = { perFeed: 40, maxAgeHours: 72, maxItems: 100, summaryLength: 50 };
const ctx = { topics: TOPICS, isExcluded: compileKeywords(EXCLUDE_KEYWORDS), limits: LIMITS, now: NOW };

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/">
<channel><title>NHK 経済</title>
<item><title>日銀 追加利上げを決定 円相場は円高に</title><link>https://www3.nhk.or.jp/news/html/a.html?utm_source=rss</link>
<pubDate>Sat, 03 Oct 2026 08:00:00 +0900</pubDate><description><![CDATA[<p>日本銀行は金融政策決定会合で&amp;追加の利上げを決めました。</p>]]></description>
<media:thumbnail url="https://example.com/a.jpg"/></item>
<item><title>プロ野球 優勝決定</title><link>https://www3.nhk.or.jp/news/html/b.html</link><pubDate>Sat, 03 Oct 2026 07:00:00 +0900</pubDate></item>
<item><title>古い記事</title><link>https://www3.nhk.or.jp/news/html/c.html</link><pubDate>Mon, 21 Sep 2026 07:00:00 +0900</pubDate></item>
<item><title>リンクなし</title></item>
</channel></rss>`;

const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"><title>Publickey</title>
<entry><title>Nvidia unveils new AI chips</title>
<link rel="alternate" type="text/html" href="https://example.com/nvidia"/>
<link rel="replies" href="https://example.com/nvidia#comments"/>
<updated>2026-10-03T06:00:00Z</updated><summary type="html">&lt;b&gt;New&lt;/b&gt; GPUs said to ship</summary></entry>
</feed>`;

const GNEWS = `<rss version="2.0"><channel><title>Google News</title>
<item><title>トヨタ 決算 最高益 - 日本経済新聞</title><link>https://news.google.com/rss/articles/abc</link>
<pubDate>Sat, 03 Oct 2026 05:00:00 GMT</pubDate><description>&lt;a href="x"&gt;links&lt;/a&gt;</description>
<source url="https://www.nikkei.com">日本経済新聞</source></item>
</channel></rss>`;

const RDF = `<?xml version="1.0"?><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel><title>ITmedia</title></channel>
<item><title>半導体工場を新設</title><link>https://example.jp/semi</link><dc:date>2026-10-03T10:00:00+09:00</dc:date><description>TSMCが発表</description></item>
</rdf:RDF>`;

test('RSS 2.0 を解析し、除外・期限切れ・リンクなしを取り除く', () => {
  const items = normalizeItems(parseFeed(RSS).items, { name: 'NHK 経済', category: 'markets', lang: 'ja' }, ctx);
  assert.equal(items.length, 1);
  const [it] = items;
  assert.equal(it.title, '日銀 追加利上げを決定 円相場は円高に');
  assert.equal(it.link, 'https://www3.nhk.or.jp/news/html/a.html'); // utm 除去
  assert.equal(it.summary, '日本銀行は金融政策決定会合で&追加の利上げを決めました。');
  assert.equal(it.image, 'https://example.com/a.jpg');
  assert.equal(it.published, '2026-10-02T23:00:00.000Z');
  assert.deepEqual(it.tags, ['rates', 'fx']);
});

test('Atom を解析し alternate リンクを使う', () => {
  const items = normalizeItems(parseFeed(ATOM).items, { name: 'Publickey', category: 'tech', lang: 'en' }, ctx);
  assert.equal(items[0].link, 'https://example.com/nvidia');
  assert.equal(items[0].summary, 'New GPUs said to ship');
  assert.ok(items[0].tags.includes('ai'));
  assert.ok(items[0].tags.includes('semi'));
});

test('Google ニュースは配信元を分離し要約を空にする', () => {
  const feed = { name: 'Google ニュース', category: 'markets', lang: 'ja', aggregator: true };
  const [it] = normalizeItems(parseFeed(GNEWS).items, feed, ctx);
  assert.equal(it.title, 'トヨタ 決算 最高益');
  assert.equal(it.source, '日本経済新聞');
  assert.equal(it.summary, '');
  assert.deepEqual(it.tags, ['earnings']);
});

test('RSS 1.0 (RDF) を解析する', () => {
  const [it] = normalizeItems(parseFeed(RDF).items, { name: 'ITmedia', category: 'tech', lang: 'ja' }, ctx);
  assert.equal(it.title, '半導体工場を新設');
  assert.equal(it.published, '2026-10-03T01:00:00.000Z');
  assert.deepEqual(it.tags, ['semi']);
});

test('英字キーワードは単語境界で照合する', () => {
  const has = compileKeywords(['AI', 'war', 'chip']);
  assert.equal(has('He said the plan was fine'), false);
  assert.equal(has('Software warehouse'), false);
  assert.equal(has('Chipotle earnings'), false);
  assert.equal(has('OpenAI and AI startups'), true);
  assert.equal(has('生成AIの活用'), true);
  assert.equal(has('Trade war escalates'), true);
  assert.equal(compileKeywords(['半導体'])('次世代半導体'), true);
});

test('重複記事（同一リンク・同一タイトル）を除き新しい順に並べる', () => {
  const base = { summary: '', source: 's', feed: 'f', category: 'markets', lang: 'ja', image: '', tags: [] };
  const out = dedupeAndSort(
    [
      { ...base, id: '1', title: 'A', link: 'https://a/1', published: '2026-10-03T01:00:00Z' },
      { ...base, id: '2', title: 'B', link: 'https://a/1', published: '2026-10-03T00:00:00Z' },
      { ...base, id: '3', title: 'A ', link: 'https://a/3', published: '2026-10-02T00:00:00Z' },
      { ...base, id: '4', title: 'C', link: 'https://a/4', published: '2026-10-03T02:00:00Z' },
    ],
    10,
  );
  assert.deepEqual(out.map((i) => i.id), ['4', '1']);
});

test('stripHtml はタグとエンティティを処理する', () => {
  assert.equal(stripHtml('<p>A&nbsp;&amp;&#x42;</p><script>x()</script>'), 'A &B');
  assert.equal(stripHtml('&lt;b&gt;bold&lt;/b&gt;'), 'bold');
});

test('parseQuote は前日比を計算する', () => {
  const q = parseQuote({ chart: { result: [{ meta: { regularMarketPrice: 110, chartPreviousClose: 100, currency: 'JPY', regularMarketTime: 1790000000 } }] } });
  assert.equal(q.price, 110);
  assert.equal(q.change, 10);
  assert.equal(q.changePercent, 10);
  assert.equal(parseQuote({ chart: { result: null } }), null);
});
