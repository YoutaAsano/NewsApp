import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDigestsFile,
  buildPrompt,
  extractStructured,
  finalizeDigest,
  jstDate,
  mergeEntries,
  previousEntries,
  selectCandidates,
} from '../scripts/digest-lib.mjs';

const NOW = Date.parse('2026-10-03T09:00:00Z'); // JST 18:00
const item = (id, hoursAgo, extra = {}) => ({
  id,
  title: `title ${id}`,
  link: `https://example.com/${id}`,
  summary: 'x'.repeat(300),
  published: new Date(NOW - hoursAgo * 3600e3).toISOString(),
  source: 'src',
  category: 'markets',
  lang: 'ja',
  tags: [],
  ...extra,
});

test('jstDate は日本時間の日付を返す', () => {
  assert.equal(jstDate(Date.parse('2026-10-02T15:30:00Z')), '2026-10-03');
  assert.equal(jstDate(Date.parse('2026-10-02T14:59:00Z')), '2026-10-02');
});

test('selectCandidates は対象ジャンルの直近24時間の記事だけを短い要約付きで返す', () => {
  const items = [item('a', 1), item('b', 23), item('c', 30), item('g', 2, { category: 'games' })];
  const c = selectCandidates(items, { now: NOW, genres: ['markets'] });
  assert.deepEqual(c.map((x) => x.id), ['a', 'b']);
  assert.equal(c[0].summary.length, 120);
  assert.equal('link' in c[0], false);
  assert.deepEqual(selectCandidates(items, { now: NOW, genres: ['games'] }).map((x) => x.id), ['g']);
});

test('buildPrompt は利用者のプロンプトの後に固定ルール・指標・記事一覧を付ける', () => {
  const c = selectCandidates([item('a', 1)], { now: NOW });
  const p = buildPrompt('  ゲーム業界の重要ニュースを選んで  ', c, { label: '業界への影響', quotes: [{ label: '日経平均', price: 1, changePercent: 1.5 }] });
  assert.ok(p.startsWith('ゲーム業界の重要ニュースを選んで\n'));
  assert.match(p, /「業界への影響」として表示される/);
  assert.match(p, /日経平均: 1（前日比 \+1.50%）/);
  assert.match(p, /"id":"a"/);
  assert.doesNotMatch(buildPrompt('x', c), /マーケット指標/);
});

test('finalizeDigest は存在しない記事 id を除き、根拠のない項目を捨てる', () => {
  const items = [item('a', 1), item('b', 2)];
  const d = finalizeDigest(
    {
      overview: ' 概況 ',
      picks: [
        { headline: 'A', summary: 's', why: 'w', kind: 'opportunity', impact: 'high', assets: ['日本株'], articleIds: ['a', 'zzz', 'a'] },
        { headline: 'B', summary: 's', why: 'w', kind: 'bogus', impact: 'low', assets: [], articleIds: ['b'] },
        { headline: 'C', summary: 's', why: 'w', kind: 'risk', impact: 'high', assets: [], articleIds: ['nope'] },
      ],
    },
    items,
    { now: NOW, model: 'opus' },
  );
  assert.equal(d.date, '2026-10-03');
  assert.equal(d.overview, '概況');
  assert.equal(d.picks.length, 2);
  assert.deepEqual(d.picks[0].articles.map((a) => a.link), ['https://example.com/a']);
  assert.equal(d.picks[1].kind, 'watch');
  assert.equal(d.picks[1].impact, 'medium');
  assert.throws(() => finalizeDigest({ overview: 'x', picks: [] }, items));
});

test('mergeEntries は同じ日付を置き換え、30日分に制限する', () => {
  const old = Array.from({ length: 30 }, (_, i) => ({ date: `2026-09-${String(30 - i).padStart(2, '0')}`, v: 1 }));
  old.unshift({ date: '2026-10-03', v: 1 });
  const merged = mergeEntries(old, { date: '2026-10-03', v: 2 });
  assert.equal(merged.length, 30);
  assert.equal(merged[0].v, 2);
  assert.equal(merged.at(-1).date, '2026-09-02');
  assert.equal(mergeEntries(old.slice(0, 3), null).length, 3);
});

test('extractStructured は structured_output を優先し、テキストの JSON にも対応する', () => {
  assert.deepEqual(extractStructured({ structured_output: { a: 1 }, result: '' }), { a: 1 });
  assert.deepEqual(extractStructured({ result: 'here: {"a":2} done' }), { a: 2 });
  assert.throws(() => extractStructured({ is_error: true, result: 'auth' }), /auth/);
});

test('previousEntries は新旧どちらの digests.json も読める', () => {
  assert.deepEqual(previousEntries({ digests: [{ date: '2026-10-03' }] }), { invest: [{ date: '2026-10-03' }] });
  assert.deepEqual(previousEntries({ digests: [{ id: 'games', entries: [{ date: 'd' }] }] }), { games: [{ date: 'd' }] });
  assert.deepEqual(previousEntries(null), {});
});

test('buildDigestsFile は設定の順に並べ、設定から消えたまとめは捨てる', () => {
  const configs = [
    { id: 'games', name: 'ゲーム業界', label: 'L', genres: ['games'], prompt: 'p' },
    { id: 'invest', name: '重要ニュース', label: 'L2', genres: ['markets'], prompt: 'p' },
  ];
  const file = buildDigestsFile(
    configs,
    { invest: [{ date: '2026-10-02' }], removed: [{ date: '2026-10-02' }] },
    { games: { date: '2026-10-03' } },
    NOW,
  );
  assert.deepEqual(file.digests.map((d) => [d.id, d.entries.map((e) => e.date)]), [
    ['games', ['2026-10-03']],
    ['invest', ['2026-10-02']],
  ]);
  assert.equal('prompt' in file.digests[0], false);
});
