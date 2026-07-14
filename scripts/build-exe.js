#!/usr/bin/env node
// Local production build: package the Node server into a Windows binary with @yao-pkg/pkg.
// Produces dist/FIFA26SkillGame.exe. Run via `npm run build:exe`.
//
// The exe contains only the server code. index.html and assets/ are staged next to it
// (NOT bundled) so pages and artwork can change on-site without a rebuild. db/ is not
// staged either — the exe creates a fresh db/database.db on first launch.

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
fs.mkdirSync(DIST, { recursive: true });

console.log('• pkg: packaging FIFA26SkillGame.exe …');
execSync(
  `npx @yao-pkg/pkg . --output "${path.join(DIST, 'FIFA26SkillGame.exe')}"`,
  { cwd: ROOT, stdio: 'inherit' }
);

console.log('• staging index.html and assets/ into dist/ …');
fs.copyFileSync(path.join(ROOT, 'index.html'), path.join(DIST, 'index.html'));
fs.cpSync(path.join(ROOT, 'assets'), path.join(DIST, 'assets'), {
  recursive: true,
  // Skip dev-only files that never ship (both are gitignored).
  filter: src => !src.includes(`${path.sep}originals_with_alpha`) && !src.endsWith('.DS_Store')
});

console.log('\n✓ Done. Ship the contents of dist/:');
console.log('    FIFA26SkillGame.exe  index.html  assets/');
console.log('  (db/ is created automatically on first launch)');
