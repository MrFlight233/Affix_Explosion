// ============================================================
// 服务端根目录解析 — 不依赖 process.cwd()
// 从当前模块向上查找含 data/seed 的 project/server 根
// ============================================================

import fs from 'fs';
import path from 'path';

let _serverRoot: string | null = null;

/**
 * 解析 project/server 根目录。
 * tsx 跑 src/ 与 tsc 输出 dist/server/src/ 层数不同，禁止写死 __dirname/../data。
 */
export function resolveServerRoot(fromDir: string = __dirname): string {
  if (_serverRoot) return _serverRoot;

  let dir = path.resolve(fromDir);
  for (let i = 0; i < 8; i++) {
    const seedDir = path.join(dir, 'data', 'seed');
    if (fs.existsSync(seedDir)) {
      _serverRoot = dir;
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  // 回退：假设当前在 server/src 或 server/dist/server/src
  const fallback = path.resolve(fromDir, '..', '..', '..');
  const fallbackSeed = path.join(fallback, 'data', 'seed');
  if (fs.existsSync(fallbackSeed)) {
    _serverRoot = fallback;
    return fallback;
  }

  // 最后回退到 cwd（仅开发兜底）
  _serverRoot = path.resolve(process.cwd());
  return _serverRoot;
}

/** 相对 server 根解析路径；绝对路径原样返回 */
export function resolveUnderServerRoot(p: string, fromDir?: string): string {
  if (path.isAbsolute(p)) return p;
  return path.resolve(resolveServerRoot(fromDir), p);
}

export function getSeedDir(fromDir?: string): string {
  return path.join(resolveServerRoot(fromDir), 'data', 'seed');
}
