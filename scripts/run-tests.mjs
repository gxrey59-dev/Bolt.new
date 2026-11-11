import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

function discover(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? discover(path) : /\.test\.(?:ts|mjs|js)$/.test(entry.name) ? [path] : [];
  });
}
const files = ['src', 'supabase/functions', 'tests'].flatMap(discover).sort();
if (!files.length) throw new Error('No tests discovered');
const result = spawnSync(process.execPath, ['--experimental-strip-types', '--test', ...files], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
