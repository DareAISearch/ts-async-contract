import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8'));
const requiredRange = pkg.engines?.node ?? '';
const requiredMajor = Number(requiredRange.match(/(\d+)/)?.[1] ?? 0);
const currentMajor = Number(process.versions.node.split('.')[0]);

if (requiredMajor > 0 && currentMajor < requiredMajor) {
  console.error(
    `\n${pkg.name} requires Node.js ${requiredRange} (you're running ${process.version}).\n` +
      'Install a compatible Node version (see .nvmrc) before installing this package.\n'
  );
  process.exit(1);
}
