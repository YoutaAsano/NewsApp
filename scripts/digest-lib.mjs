// 「今日の重要ニュース」ダイジェスト生成用の純粋関数群（テスト対象）。

export const DIGEST_KEEP_DAYS = 30;
const JST_OFFSET_MS = 9 * 3600 * 1000;

// 日本時間の日付文字列（YYYY-MM-DD）
export const jstDate = (ms) => new Date(ms + JST_OFFSET_MS).toISOString().slice(0, 10);

// Claude に渡す候補記事（直近24時間・新しい順）を選ぶ
export function selectCandidates(items, { now = Date.now(), hours = 24, max = 250 } = {}) {
  const since = now - hours * 3600 * 1000;
  return items
    .filter((it) => Date.parse(it.published) >= since)
    .slice(0, max)
    .map((it) => ({
      id: it.id,
      source: it.source,
      category: it.category,
      tags: it.tags,
      title: it.title,
      summary: it.summary ? it.summary.slice(0, 120) : '',
    }));
}

export const DIGEST_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['overview', 'picks'],
  properties: {
    overview: { type: 'string', description: '今日の経済・市場・世界情勢の大きな流れ（日本語3〜5文）' },
    picks: {
      type: 'array',
      minItems: 1,
      maxItems: 10,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['headline', 'summary', 'why', 'kind', 'impact', 'assets', 'articleIds'],
        properties: {
          headline: { type: 'string', description: '日本語の短い見出し（40字以内）' },
          summary: { type: 'string', description: '何が起きたか（日本語2〜3文）' },
          why: { type: 'string', description: '資産形成の観点で重要な理由・考えられる影響（日本語1〜3文）' },
          kind: { type: 'string', enum: ['opportunity', 'risk', 'watch'] },
          impact: { type: 'string', enum: ['high', 'medium'] },
          assets: { type: 'array', items: { type: 'string' }, description: '関連する資産・市場・セクター（例: 日本株, ドル円, 半導体株）' },
          articleIds: { type: 'array', items: { type: 'string' }, description: '根拠となる記事の id（入力にあるもののみ）' },
        },
      },
    },
  },
};

export function buildPrompt(candidates, quotes = []) {
  const market = quotes.length
    ? quotes
        .map((q) => `- ${q.label}: ${q.price}${q.changePercent != null ? `（前日比 ${q.changePercent >= 0 ? '+' : ''}${q.changePercent.toFixed(2)}%）` : ''}`)
        .join('\n')
    : '（取得できませんでした）';
  return `あなたは個人投資家向けのマーケットアナリストです。以下は直近24時間に配信された経済・世界情勢・テクノロジー・暗号資産のニュース見出しです。
資産を増やしたい個人投資家にとって「今日特に重要なニュース」を5〜8件選び、日本語で要約してください。

重要度の基準:
- 出来事の規模が大きい（市場全体・複数国・主要企業に影響する、政策や金利・為替の大きな変化、大規模な紛争や合意など）
- 資産を増やす観点でチャンスになり得る（成長分野の追い風、割安になった資産、規制緩和、好決算、新技術の商用化など）
- 大きなリスク要因で、資産を守るために知っておくべきもの
- 同じ話題を複数の配信元が報じているものは重要度が高い可能性がある
- スポーツ・芸能・事件など投資に関係しない話題、細かな製品レビューは選ばない

ルール:
- 同じ出来事を報じた複数の記事は1件にまとめ、articleIds に該当する記事の id をすべて入れる（最大4件）
- articleIds には必ず下の一覧にある id だけを使う
- kind: opportunity=投資機会になり得る / risk=警戒すべきリスク / watch=今後の動向を注視
- impact: high=市場全体や多くの資産に影響 / medium=特定の分野・資産に影響
- why では、どの資産にどんな影響があり得るかを具体的に書く。ただし特定銘柄の売買を断定的に推奨しない
- 見出しに書かれていない事実を推測で断定しない
- overview ではマーケット指標の動きにも触れ、今日の全体像を3〜5文でまとめる
- 重要度の高い順に並べる

マーケット指標:
${market}

ニュース一覧（JSON Lines）:
${candidates.map((c) => JSON.stringify(c)).join('\n')}`;
}

// Claude の出力を検証し、記事 id を実在する記事のリンクに解決する
export function finalizeDigest(raw, items, { now = Date.now(), model = '' } = {}) {
  if (!raw || typeof raw.overview !== 'string' || !Array.isArray(raw.picks)) throw new Error('invalid digest output');
  const byId = new Map(items.map((it) => [it.id, it]));
  const picks = raw.picks
    .map((p) => {
      const articles = [...new Set(p.articleIds ?? [])]
        .map((id) => byId.get(id))
        .filter(Boolean)
        .slice(0, 4)
        .map((it) => ({ id: it.id, title: it.title, link: it.link, source: it.source, lang: it.lang }));
      return {
        headline: String(p.headline ?? '').trim(),
        summary: String(p.summary ?? '').trim(),
        why: String(p.why ?? '').trim(),
        kind: ['opportunity', 'risk', 'watch'].includes(p.kind) ? p.kind : 'watch',
        impact: p.impact === 'high' ? 'high' : 'medium',
        assets: (p.assets ?? []).map(String).filter(Boolean).slice(0, 5),
        articles,
      };
    })
    .filter((p) => p.headline && p.summary && p.articles.length > 0);
  if (picks.length === 0) throw new Error('digest has no valid picks');
  return { date: jstDate(now), generatedAt: new Date(now).toISOString(), model, overview: raw.overview.trim(), picks };
}

// 同じ日付は新しいもので置き換え、新しい順に最大30日分残す
export function mergeDigests(existing, digest, keepDays = DIGEST_KEEP_DAYS) {
  const byDate = new Map((existing ?? []).filter((d) => d?.date).map((d) => [d.date, d]));
  if (digest) byDate.set(digest.date, digest);
  return [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date)).slice(0, keepDays);
}

// CLI の --output-format json の結果から構造化出力を取り出す
export function extractStructured(cliJson) {
  if (cliJson?.is_error) throw new Error(`claude error: ${cliJson.result ?? cliJson.subtype ?? 'unknown'}`);
  if (cliJson?.structured_output && typeof cliJson.structured_output === 'object') return cliJson.structured_output;
  const text = String(cliJson?.result ?? '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('no JSON in claude output');
  return JSON.parse(text.slice(start, end + 1));
}
