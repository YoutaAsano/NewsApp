// フィード解析・正規化・フィルタリングの純粋関数群（テスト対象）。
import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  textNodeName: '#text',
  processEntities: true,
  htmlEntities: true,
  trimValues: true,
  // CDATA はテキストとして結合する
  cdataPropName: false,
});

const asArray = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

// XML ノード（文字列 / {#text} / 数値）からテキストを取り出す
function text(node) {
  if (node == null) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return text(node[0]);
  if (typeof node === 'object' && '#text' in node) return String(node['#text']);
  return '';
}

const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return NAMED_ENTITIES[e.toLowerCase()] ?? m;
  });
}

export function stripHtml(s) {
  return decodeEntities(
    String(s)
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/<[^>]+>/g, ' ') // エンティティ化されていたタグを再度除去
    .replace(/\s+/g, ' ')
    .trim();
}

export function truncate(s, n) {
  const chars = Array.from(s);
  return chars.length <= n ? s : chars.slice(0, n - 1).join('') + '…';
}

function atomLink(links) {
  const list = asArray(links);
  const alt = list.find((l) => typeof l === 'object' && (!l['@rel'] || l['@rel'] === 'alternate'));
  const chosen = alt ?? list[0];
  if (!chosen) return '';
  return typeof chosen === 'object' ? chosen['@href'] ?? text(chosen) : String(chosen);
}

function findImage(item) {
  const candidates = [
    ...asArray(item['media:content']),
    ...asArray(item['media:thumbnail']),
    ...asArray(item['media:group']?.['media:content']),
    ...asArray(item.enclosure).filter((e) => /^image\//.test(e?.['@type'] ?? '')),
  ];
  for (const c of candidates) {
    const url = c?.['@url'];
    if (url && /^https?:\/\//.test(url) && c['@medium'] !== 'video') return url;
  }
  const html = text(item['content:encoded']) || text(item.description) || text(item.content);
  const m = html.match(/<img[^>]+src=["'](https?:\/\/[^"']+)["']/i);
  return m ? decodeEntities(m[1]) : '';
}

function parseDate(...values) {
  for (const v of values) {
    const s = text(v);
    if (!s) continue;
    const t = Date.parse(s);
    if (!Number.isNaN(t)) return new Date(t).toISOString();
  }
  return null;
}

// RSS 2.0 / RSS 1.0 (RDF) / Atom を解析し、生の記事リストを返す
export function parseFeed(xml) {
  const doc = parser.parse(xml);

  if (doc.rss?.channel || doc['rdf:RDF']) {
    const channel = doc.rss?.channel ?? doc['rdf:RDF'].channel ?? {};
    const items = asArray(doc.rss?.channel?.item ?? doc['rdf:RDF']?.item);
    return {
      title: text(channel.title),
      items: items.map((it) => ({
        title: text(it.title),
        link: text(it.link) || (typeof it.guid === 'object' ? text(it.guid) : String(it.guid ?? '')),
        summary: text(it.description) || text(it['content:encoded']),
        published: parseDate(it.pubDate, it['dc:date'], it.published, it.updated),
        image: findImage(it),
        source: text(it.source), // Google ニュースの配信元
      })),
    };
  }

  if (doc.feed) {
    const entries = asArray(doc.feed.entry);
    return {
      title: text(doc.feed.title),
      items: entries.map((e) => ({
        title: text(e.title),
        link: atomLink(e.link),
        summary: text(e.summary) || text(e.content),
        published: parseDate(e.published, e.updated, e['dc:date']),
        image: findImage(e),
        source: '',
      })),
    };
  }

  throw new Error('Unsupported feed format');
}

// ---- キーワードマッチ ----

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ASCII のキーワードは単語境界で照合する（"AI" が "said" にマッチしないように）。
// 3文字以下の大文字略語（AI, ETH 等）は大文字小文字を区別する。
export function compileKeywords(keywords) {
  const ascii = [];
  const acronyms = [];
  const other = [];
  for (const k of keywords) {
    if (/^[\x20-\x7e]+$/.test(k)) {
      if (k.length <= 3 && k === k.toUpperCase()) acronyms.push(k);
      else ascii.push(k);
    } else {
      other.push(k);
    }
  }
  const re = [];
  if (ascii.length) re.push(new RegExp(`(?<![A-Za-z0-9])(?:${ascii.map(escapeRe).join('|')})(?![A-Za-z0-9])`, 'i'));
  if (acronyms.length) re.push(new RegExp(`(?<![A-Za-z0-9])(?:${acronyms.map(escapeRe).join('|')})(?![A-Za-z0-9])`));
  if (other.length) re.push(new RegExp(other.map(escapeRe).join('|'), 'i'));
  return (s) => re.some((r) => r.test(s));
}

// ---- 正規化 ----

export function normalizeLink(url) {
  try {
    const u = new URL(url);
    for (const p of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|ref$|cmpid|taid|yptr|guccounter)/i.test(p)) u.searchParams.delete(p);
    }
    u.hash = '';
    return u.toString();
  } catch {
    return url;
  }
}

const titleKey = (t) => t.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');

function hashId(s) {
  // FNV-1a 32bit（記事 ID 用。衝突しても既読/保存が混ざる程度の影響）
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

// Google ニュースのタイトル末尾 " - 配信元" を分離
function splitAggregatorTitle(title, source) {
  if (source && title.endsWith(` - ${source}`)) return title.slice(0, -(source.length + 3));
  const m = title.match(/^(.*) - ([^-]{1,40})$/);
  return m ? m[1] : title;
}

export function normalizeItems(rawItems, feed, { topics, isExcluded, limits, now = Date.now() }) {
  const topicMatchers = topics.map((t) => ({ id: t.id, match: compileKeywords(t.keywords) }));
  const out = [];
  for (const raw of rawItems.slice(0, limits.perFeed)) {
    let title = stripHtml(raw.title);
    const link = normalizeLink(String(raw.link || '').trim());
    if (!title || !/^https?:\/\//.test(link)) continue;

    let source = feed.name;
    if (feed.aggregator) {
      const origin = stripHtml(raw.source);
      title = splitAggregatorTitle(title, origin);
      if (origin) source = origin;
    }

    const published = raw.published ?? new Date(now).toISOString();
    const ageHours = (now - Date.parse(published)) / 3.6e6;
    if (ageHours > limits.maxAgeHours) continue;

    if (isExcluded(title)) continue;

    // Google ニュースの description はリンク一覧なので要約に使わない
    let summary = feed.aggregator ? '' : stripHtml(raw.summary);
    if (summary === title) summary = '';
    summary = truncate(summary, limits.summaryLength);

    const haystack = `${title} ${summary}`;
    const tags = topicMatchers.filter((t) => t.match(haystack)).map((t) => t.id);

    out.push({
      id: hashId(link),
      title,
      link,
      summary,
      published: ageHours < -1 ? new Date(now).toISOString() : published, // 未来日付は補正
      source,
      feed: feed.name,
      category: feed.category,
      lang: feed.lang,
      image: raw.image || '',
      tags,
    });
  }
  return out;
}

// リンクとタイトルで重複を除去し、新しい順に並べる
export function dedupeAndSort(items, maxItems) {
  const sorted = [...items].sort((a, b) => b.published.localeCompare(a.published));
  const seenLinks = new Set();
  const seenTitles = new Set();
  const out = [];
  for (const it of sorted) {
    const tk = titleKey(it.title);
    if (seenLinks.has(it.link) || seenTitles.has(tk)) continue;
    seenLinks.add(it.link);
    seenTitles.add(tk);
    out.push(it);
    if (out.length >= maxItems) break;
  }
  return out;
}

// Yahoo Finance チャート API のレスポンスから現在値と前日比を取り出す
export function parseQuote(json) {
  const meta = json?.chart?.result?.[0]?.meta;
  if (!meta || typeof meta.regularMarketPrice !== 'number') return null;
  const price = meta.regularMarketPrice;
  const prev = meta.previousClose ?? meta.chartPreviousClose;
  const change = typeof prev === 'number' ? price - prev : null;
  return {
    price,
    change,
    changePercent: change != null && prev ? (change / prev) * 100 : null,
    currency: meta.currency ?? '',
    time: meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : null,
  };
}
