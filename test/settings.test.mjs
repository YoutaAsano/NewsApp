import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseSettings, SETTINGS_PATH } from '../scripts/settings.mjs';

test('リポジトリの settings.yml は正しく読み込める', async () => {
  const s = parseSettings(await readFile(SETTINGS_PATH, 'utf8'));
  assert.ok(s.genres.includes('games'));
  assert.deepEqual(s.digests.map((d) => d.id), ['invest', 'games']);
  assert.ok(s.digests.every((d) => d.prompt.length > 20));
});

test('ラベル省略時は「ポイント」、name 省略時は id を使う', () => {
  const s = parseSettings('genres: [games]\ndigests:\n  - id: g\n    genres: [games]\n    prompt: hi\n');
  assert.equal(s.digests[0].label, 'ポイント');
  assert.equal(s.digests[0].name, 'g');
});

test('誤りはまとめて日本語で報告する', () => {
  const bad = `genres: [games, sports]
digests:
  - id: x
    genres: [markets]
    prompt: ""
  - id: x
    genres: [games]
    prompt: ok
`;
  assert.throws(
    () => parseSettings(bad),
    (e) =>
      /「sports」は存在しない/.test(e.message) &&
      /「markets」は上の genres で収集されていません/.test(e.message) &&
      /prompt を書いてください/.test(e.message) &&
      /重複/.test(e.message),
  );
  assert.throws(() => parseSettings('genres: [games\n'), /書式に誤り/);
  assert.throws(() => parseSettings('digests: []'), /ジャンルを1つ以上/);
});
