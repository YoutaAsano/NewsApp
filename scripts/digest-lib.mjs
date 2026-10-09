// AI まとめ（ダイジェスト）生成用の純粋関数群（テスト対象）。
// まとめの種類・対象ジャンル・プロンプトは settings.yml の digests で設定する。

export const DIGEST_KEEP_DAYS = 30;
const JST_OFFSET_MS = 9 * 3600 * 1000;

// 日本時間の日付文字列（YYYY-MM-DD）
export const jstDate = (ms) => new Date(ms + JST_OFFSET_MS).toISOString().slice(0, 10);

// Claude に渡す候補記事（対象ジャンル・直近24時間・新しい順）を選ぶ
export function selectCandidates(items, { genres = null, now = Date.now(), hours = 24, max = 250 } = {}) {
  const since = now - hours * 3600 * 1000;
  return items
    .filter((it) => (!genres || genres.includes(it.category)) && Date.parse(it.published) >= since)
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
    overview: { type: 'string', description: '今日の全体像（日本語3〜5文）' },
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
          why: { type: 'string', description: '重要な理由・考えられる影響（日本語1〜3文）' },
          kind: { type: 'string', enum: ['opportunity', 'risk', 'watch'] },
          impact: { type: 'string', enum: ['high', 'medium'] },
          assets: { type: 'array', items: { type: 'string' }, description: '関連する資産・市場・企業・分野（短い名詞で最大5つ）' },
          articleIds: { type: 'array', items: { type: 'string' }, description: '根拠となる記事の id（入力にあるもののみ）' },
        },
      },
    },
  },
};

// 利用者のプロンプト（settings.yml）に、出力形式と根拠記事の扱いに関する固定のルールを付け足す
export function buildPrompt(userPrompt, candidates, { label = 'ポイント', quotes = [] } = {}) {
  const market = quotes.length
    ? `\n\nマーケット指標:\n${quotes
        .map((q) => `- ${q.label}: ${q.price}${q.changePercent != null ? `（前日比 ${q.changePercent >= 0 ? '+' : ''}${q.changePercent.toFixed(2)}%）` : ''}`)
        .join('\n')}`
    : '';
  return `${userPrompt.trim()}

---
以下は直近24時間に配信されたニュースの見出しです。上の指示に従って重要なニュースを選び、日本語でまとめてください。

出力に関するルール（必ず守ること）:
- 件数の指定がなければ5〜8件選び、重要度の高い順に並べる
- 同じ出来事を報じた複数の記事は1件にまとめ、articleIds に該当する記事の id をすべて入れる（最大4件）
- articleIds には必ず下の一覧にある id だけを使う
- headline: 日本語の短い見出し / summary: 何が起きたか（2〜3文）
- why: 「${label}」として表示される解説（1〜3文）
- kind: opportunity=好機・追い風 / risk=懸念・逆風 / watch=今後の動向を注視
- impact: high=影響範囲が広い / medium=特定の分野に影響
- assets: 関連する資産・市場・企業・分野
- overview: 今日の全体像を3〜5文でまとめる
- 見出しに書かれていない事実を推測で断定しない${market}

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
export function mergeEntries(existing, digest, keepDays = DIGEST_KEEP_DAYS) {
  const byDate = new Map((existing ?? []).filter((d) => d?.date).map((d) => [d.date, d]));
  if (digest) byDate.set(digest.date, digest);
  return [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date)).slice(0, keepDays);
}

// 公開中の digests.json を「まとめ id → 過去のエントリ」に変換する。
// 旧形式（まとめが1種類だった頃の { digests: [{ date, ... }] }）は id "invest" として引き継ぐ。
export function previousEntries(json) {
  const list = json?.digests ?? [];
  if (list.length && list[0]?.date) return { invest: list };
  return Object.fromEntries(list.filter((d) => d?.id).map((d) => [d.id, d.entries ?? []]));
}

// settings.yml の digests の並び順で、新しいエントリを反映した digests.json の中身を作る
export function buildDigestsFile(configs, previous, generated, now = Date.now()) {
  return {
    updatedAt: new Date(now).toISOString(),
    digests: configs.map((c) => ({
      id: c.id,
      name: c.name,
      label: c.label,
      genres: c.genres,
      entries: mergeEntries(previous[c.id], generated[c.id] ?? null),
    })),
  };
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
