// AI まとめ（ダイジェスト）を管理する。まとめの種類とプロンプトは settings.yml の digests で設定する。
//   node scripts/digest.mjs             … 過去のまとめを引き継ぐだけ
//   node scripts/digest.mjs --generate  … さらに Claude Code で今日のまとめを生成・更新
//
// 公開中のサイトから過去30日分の digests.json を取得して引き継ぐ（環境変数 SITE_URL）。
// 生成には Claude のサブスクリプション（CLAUDE_CODE_OAUTH_TOKEN）または API キーを使う。
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DIGEST_SCHEMA, buildDigestsFile, buildPrompt, extractStructured, finalizeDigest, previousEntries, selectCandidates } from './digest-lib.mjs';
import { loadSettings } from './settings.mjs';

const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data');
const OUT = join(DATA, 'digests.json');
const MODEL = process.env.DIGEST_MODEL || 'opus';

const readJson = async (path, fallback) => {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return fallback;
  }
};

async function loadPrevious() {
  const site = process.env.SITE_URL;
  if (!site) return previousEntries(await readJson(OUT, null));
  const url = `${site.replace(/\/$/, '')}/data/digests.json?t=${Date.now()}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (res.status === 404) {
    console.log('過去のまとめはまだありません（初回）');
    return {};
  }
  // 一時的な失敗で履歴を消さないよう、404 以外のエラーではデプロイを中止する
  if (!res.ok) throw new Error(`過去のまとめの取得に失敗しました: HTTP ${res.status}`);
  return previousEntries(await res.json());
}

function runClaude(prompt, cwd) {
  const args = [
    '-p',
    '--output-format', 'json',
    '--json-schema', JSON.stringify(DIGEST_SCHEMA),
    '--model', MODEL,
    '--tools', '',
    '--strict-mcp-config',
    '--no-session-persistence',
  ];
  return new Promise((resolve, reject) => {
    const child = spawn('claude', args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), 15 * 60 * 1000);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0 && !out) return reject(new Error(`claude exited with ${code}: ${err.slice(0, 500)}`));
      try {
        resolve(JSON.parse(out));
      } catch {
        reject(new Error(`claude の出力を解析できません: ${out.slice(0, 300)} ${err.slice(0, 300)}`));
      }
    });
    child.stdin.end(prompt);
  });
}

async function generateAll(configs) {
  // ローカルでは `claude` のログイン情報を使うので、未設定チェックは CI のみ
  if (process.env.CI && !process.env.CLAUDE_CODE_OAUTH_TOKEN && !process.env.ANTHROPIC_API_KEY) {
    console.log('::warning::CLAUDE_CODE_OAUTH_TOKEN が未設定のため、まとめの生成をスキップしました');
    return {};
  }
  const news = await readJson(join(DATA, 'news.json'), null);
  if (!news?.items?.length) throw new Error('news.json がありません。先に npm run fetch を実行してください');
  const markets = await readJson(join(DATA, 'markets.json'), { quotes: [] });

  const generated = {};
  for (const config of configs) {
    try {
      generated[config.id] = await generateOne(config, news.items, markets.quotes);
    } catch (e) {
      // 1つのまとめが失敗しても、他のまとめとニュース本体の更新は止めない
      console.log(`::warning::「${config.name}」の生成に失敗しました: ${e.message}`);
    }
  }
  return generated;
}

async function generateOne(config, items, quotes) {
  const candidates = selectCandidates(items, { genres: config.genres });
  if (candidates.length < 5) throw new Error(`対象ジャンルの直近の記事が少なすぎます（${candidates.length} 件）`);
  console.log(`「${config.name}」: 候補記事 ${candidates.length} 件から選定中（モデル: ${MODEL}）…`);

  // マーケット指標は経済・暗号資産を含むまとめにだけ渡す
  const withMarket = config.genres.some((g) => g === 'markets' || g === 'crypto');
  const prompt = buildPrompt(config.prompt, candidates, { label: config.label, quotes: withMarket ? quotes : [] });

  // リポジトリの設定やファイルを読み込ませないよう、空の作業ディレクトリで実行する
  const cwd = await mkdtemp(join(tmpdir(), 'digest-'));
  try {
    const result = await runClaude(prompt, cwd);
    const digest = finalizeDigest(extractStructured(result), items, { model: MODEL });
    console.log(`「${config.name}」${digest.date} のまとめを生成しました（${digest.picks.length} 件）`);
    return digest;
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

const { digests: configs } = await loadSettings();
const previous = await loadPrevious();
let generated = {};
if (process.argv.includes('--generate')) {
  try {
    generated = await generateAll(configs);
  } catch (e) {
    console.log(`::warning::まとめの生成に失敗しました: ${e.message}`);
  }
}
const file = buildDigestsFile(configs, previous, generated);
await writeFile(OUT, JSON.stringify(file));
for (const d of file.digests) console.log(`「${d.name}」: ${d.entries.length} 日分を保存しました`);
