#!/usr/bin/env node
// Write one version into the three files the release depends on.
//
//   npm run version:set -- 0.2.0
//
// The updater compares the version baked into the binary against the manifest,
// so `package.json`, `tauri.conf.json` and `Cargo.toml` must never drift.
// `npm version` owns the first two (and the lockfile); the rest is a rewrite.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const VERSION = /^\d+\.\d+\.\d+$/;

const next = (process.argv[2] ?? '').replace(/^v/, '');
if (!VERSION.test(next)) {
  console.error(`Uso: npm run version:set -- 0.2.0 (recebido: ${process.argv[2] ?? 'nada'})`);
  process.exit(1);
}

/** Replace the first match and refuse to write a file that did not change. */
function bump(path, pattern, replacement) {
  const source = readFileSync(path, 'utf8');
  if (!pattern.test(source)) {
    console.error(`${path}: o campo de versão não foi encontrado.`);
    process.exit(1);
  }
  const updated = source.replace(pattern, replacement);
  if (updated === source) {
    console.error(`${path}: já está na versão ${next}.`);
    process.exit(1);
  }
  writeFileSync(path, updated);
  console.log(`${path}: ${next}`);
}

// package.json and package-lock.json are npm's to rewrite.
execFileSync('npm', ['version', next, '--no-git-tag-version', '--allow-same-version'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

bump('src-tauri/tauri.conf.json', /"version":\s*"[^"]*"/, `"version": "${next}"`);
bump('src-tauri/Cargo.toml', /^version = "[^"]*"/m, `version = "${next}"`);

// Cargo.lock carries the same package version; leave it to the next build.
console.log('Rode `cargo check` ou `npm run build` para atualizar o Cargo.lock.');
