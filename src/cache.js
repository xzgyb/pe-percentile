import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export function createCache(dir, { ttlMs = 12 * 3600 * 1000, enabled = true } = {}) {
  return {
    async read(key) {
      if (!enabled) return null;
      try {
        const raw = await readFile(join(dir, `${key}.json`), 'utf8');
        const parsed = JSON.parse(raw);
        if (Date.now() - parsed.fetchedAt > ttlMs) return null;
        return parsed.data;
      } catch {
        return null;
      }
    },
    async write(key, data) {
      if (!enabled) return;
      const file = join(dir, `${key}.json`);
      try {
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, JSON.stringify({ fetchedAt: Date.now(), data }), 'utf8');
      } catch {
        /* cache 写入失败不影响主流程 */
      }
    },
  };
}
