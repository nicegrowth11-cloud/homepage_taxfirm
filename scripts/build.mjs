// 공개 파일만 dist/로 복사합니다(README, 보안 규칙, 스크립트 등은 배포 대상에서 제외).
import { mkdir, copyFile, rm, stat } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'dist');
const files = ['index.html', 'style.css', 'script.js', 'consult.js', 'consult-forms.json', 'assets/logo-dark.svg', 'assets/fonts/SUIT-Variable.woff2', 'assets/fonts/SUIT-LICENSE.txt', 'assets/SIMPLE-ICONS-LICENSE.md'];
await rm(out, { recursive: true, force: true });
let size = 0;
for (const f of files) {
  await mkdir(dirname(resolve(out, f)), { recursive: true });
  await copyFile(resolve(root, f), resolve(out, f));
  size += (await stat(resolve(out, f))).size;
}
console.log(`Built ${files.length} files (${(size / 1024).toFixed(0)} KB) in dist/`);
