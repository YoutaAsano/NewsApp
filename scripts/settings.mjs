// settings.yml（収集ジャンルと AI まとめの設定）の読み込みと検証。
import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { GENRES } from '../config/feeds.mjs';

export const SETTINGS_PATH = new URL('../settings.yml', import.meta.url);

// 設定の誤りは日本語のメッセージにまとめて投げる（Actions のログで確認できるように）
export function parseSettings(text) {
  let raw;
  try {
    raw = parse(text) ?? {};
  } catch (e) {
    throw new Error(`settings.yml の書式に誤りがあります（字下げや記号を確認してください）: ${e.message}`);
  }
  const known = new Map(GENRES.map((g) => [g.id, g]));
  const knownList = GENRES.map((g) => `${g.id}（${g.label}）`).join(', ');
  const errors = [];

  const genres = [...new Set((Array.isArray(raw.genres) ? raw.genres : []).map(String))];
  for (const g of genres) if (!known.has(g)) errors.push(`genres の「${g}」は存在しないジャンルです。使えるジャンル: ${knownList}`);
  if (genres.length === 0) errors.push('genres にジャンルを1つ以上書いてください');

  const ids = new Set();
  const digests = (Array.isArray(raw.digests) ? raw.digests : []).map((d, i) => {
    const where = `digests の${i + 1}番目`;
    const id = String(d?.id ?? '').trim();
    if (!/^[A-Za-z0-9_-]+$/.test(id)) errors.push(`${where}: id は英数字（- と _ も可）で書いてください`);
    else if (ids.has(id)) errors.push(`${where}: id「${id}」が重複しています`);
    ids.add(id);
    const dg = [...new Set((Array.isArray(d?.genres) ? d.genres : []).map(String))];
    if (dg.length === 0) errors.push(`${where}: genres を1つ以上書いてください`);
    for (const g of dg) {
      if (!known.has(g)) errors.push(`${where}: genres の「${g}」は存在しないジャンルです。使えるジャンル: ${knownList}`);
      else if (!genres.includes(g)) errors.push(`${where}: ジャンル「${g}」は上の genres で収集されていません`);
    }
    const prompt = String(d?.prompt ?? '').trim();
    if (!prompt) errors.push(`${where}: prompt を書いてください`);
    return {
      id,
      name: String(d?.name ?? id).trim() || id,
      genres: dg,
      label: String(d?.label ?? 'ポイント').trim() || 'ポイント',
      prompt,
    };
  });

  if (errors.length) throw new Error(`settings.yml に誤りがあります:\n- ${errors.join('\n- ')}`);
  return { genres, digests };
}

export async function loadSettings() {
  return parseSettings(await readFile(SETTINGS_PATH, 'utf8'));
}

// アプリから設定ファイルを開く・編集するための GitHub の URL（Actions 上でのみ分かる）
export function settingsUrls(env = process.env) {
  const repo = env.GITHUB_REPOSITORY;
  const branch = env.GITHUB_REF_NAME || 'main';
  if (!repo) return null;
  return {
    view: `https://github.com/${repo}/blob/${branch}/settings.yml`,
    edit: `https://github.com/${repo}/edit/${branch}/settings.yml`,
    actions: `https://github.com/${repo}/actions/workflows/deploy.yml`,
  };
}
