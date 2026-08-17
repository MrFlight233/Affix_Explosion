// ============================================================
// API 客户端 — 封装后端 HTTP 请求
// ============================================================

const BASE = '/api';

let token: string | null = localStorage.getItem('ae_token');

/** 401 钩子：局内过期时由 main/UI 注入（不销毁引擎） */
let onUnauthorized: (() => void) | null = null;

export function setOnUnauthorized(handler: (() => void) | null) {
  onUnauthorized = handler;
}

export function setToken(t: string | null) {
  token = t;
  if (t) localStorage.setItem('ae_token', t);
  else localStorage.removeItem('ae_token');
}

export function getToken(): string | null { return token; }

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.name = 'ApiError';
  }
}

async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (!options.method || options.method === 'GET') {
    headers['Cache-Control'] = 'no-cache';
  }

  const res = await fetch(`${BASE}${url}`, { ...options, headers });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: '请求失败' }));
    if (res.status === 401) {
      onUnauthorized?.();
    }
    throw new ApiError(body.error || `HTTP ${res.status}`, res.status);
  }
  return res.json();
}

// Auth
export const auth = {
  register: (username: string, password: string) =>
    request<{token:string;user:{id:number;username:string}}>('/auth/register', {
      method:'POST', body:JSON.stringify({username,password}),
    }),
  login: (username: string, password: string) =>
    request<{token:string;user:{id:number;username:string}}>('/auth/login', {
      method:'POST', body:JSON.stringify({username,password}),
    }),
  me: () => request<{ userId: number; username: string }>('/auth/me'),
};

// Data
export const data = {
  getAll: () => request<{entities:any[];affixes:any[];version:number}>('/data/all'),
  uploadBD: (round: number, bd: any) =>
    request<{id:number}>('/data/battle-pool', {
      method:'POST', body:JSON.stringify({round, bd_json:JSON.stringify(bd)}),
    }),
  getBattlePool: (round: number) =>
    request<{opponent:any | null}>('/data/battle-pool?' + new URLSearchParams({round:String(round)})),
};

// Admin
let _isAdmin: boolean | null = null;
export async function checkAdmin(): Promise<boolean> {
  if (_isAdmin !== null) return _isAdmin;
  try {
    const res = await request<{ admin: boolean; username: string }>('/admin/check');
    _isAdmin = res.admin;
    return _isAdmin;
  } catch {
    _isAdmin = false;
    return false;
  }
}
export function resetAdminCache() { _isAdmin = null; }

export const admin = {
  check: () => request<{ admin: boolean; username: string }>('/admin/check'),

  // Entities
  listEntities: () =>
    request<{ entities: any[]; version: number }>('/admin/entities'),
  getEntity: (id: string) =>
    request<{ entity: any }>(`/admin/entities/${encodeURIComponent(id)}`),
  createEntity: (data: any) =>
    request<{ ok: boolean; id: string }>('/admin/entities', {
      method: 'POST', body: JSON.stringify(data),
    }),
  importEntities: (items: any[], overwrite = false) =>
    request<{ imported: number; skipped: number; errors: any[] }>('/admin/entities/import', {
      method: 'POST', body: JSON.stringify({ items, overwrite }),
    }),
  updateEntity: (id: string, data: any) =>
    request<{ ok: boolean }>(`/admin/entities/${encodeURIComponent(id)}`, {
      method: 'PUT', body: JSON.stringify(data),
    }),
  deleteEntity: (id: string) =>
    request<{ ok: boolean }>(`/admin/entities/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  clearAllEntities: () =>
    request<{ ok: boolean; deleted: number }>('/admin/entities', { method: 'DELETE' }),

  // Affixes
  listAffixes: () =>
    request<{ affixes: any[]; version: number }>('/admin/affixes'),
  getAffix: (id: string) =>
    request<{ affix: any }>(`/admin/affixes/${encodeURIComponent(id)}`),
  createAffix: (data: any) =>
    request<{ ok: boolean; id: string }>('/admin/affixes', {
      method: 'POST', body: JSON.stringify(data),
    }),
  importAffixes: (items: any[], overwrite = false) =>
    request<{ imported: number; skipped: number; errors: any[] }>('/admin/affixes/import', {
      method: 'POST', body: JSON.stringify({ items, overwrite }),
    }),
  updateAffix: (id: string, data: any) =>
    request<{ ok: boolean }>(`/admin/affixes/${encodeURIComponent(id)}`, {
      method: 'PUT', body: JSON.stringify(data),
    }),
  deleteAffix: (id: string) =>
    request<{ ok: boolean }>(`/admin/affixes/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  clearAllAffixes: () =>
    request<{ ok: boolean; deleted: number }>('/admin/affixes', { method: 'DELETE' }),

  // Categories
  listCategories: () =>
    request<{ categories: any[] }>('/admin/categories'),
  createCategory: (data: any) =>
    request<{ ok: boolean; id: string }>('/admin/categories', {
      method: 'POST', body: JSON.stringify(data),
    }),
  updateCategory: (id: string, data: any) =>
    request<{ ok: boolean }>(`/admin/categories/${encodeURIComponent(id)}`, {
      method: 'PUT', body: JSON.stringify(data),
    }),
  deleteCategory: (id: string) =>
    request<{ ok: boolean }>(`/admin/categories/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  // Seed
  publishSeed: () =>
    request<{ ok: boolean; path: string; entities: number; affixes: number; categories: number; version: number }>(
      '/admin/seed/publish', { method: 'POST' },
    ),
  seedStatus: () =>
    request<{ exists: boolean; path: string; meta: any }>('/admin/seed/status'),
};

// Saves
export const saves = {
  list: () => request<{save:{data_json:string;updated_at:string}|null}>('/saves'),
  put: (data:any) =>
    request<{ok:boolean}>('/saves', {
      method:'PUT', body:JSON.stringify({data_json:JSON.stringify(data)}),
    }),
  del: () => request<{ok:boolean}>('/saves', {method:'DELETE'}),
};

export type HistoryRunStatus = 'in_progress' | 'cleared';

export interface HistoryRunSummary {
  id: number;
  created_at: string;
  status?: HistoryRunStatus;
  wins?: number;
  losses?: number;
  maxRound?: number;
  battles: number;
  gold?: number;
  totalGoldGained?: number;
}

export const history = {
  list: () => request<{ runs: HistoryRunSummary[] }>('/history'),
  get: (id: number) => request<{ id: number; created_at: string; run: any }>(`/history/${id}`),
  /** @deprecated 使用 create */
  archive: (run: any) =>
    request<{ ok: boolean; id: number }>('/history', {
      method: 'POST', body: JSON.stringify({ run }),
    }),
  create: (run: any) =>
    request<{ ok: boolean; id: number }>('/history', {
      method: 'POST', body: JSON.stringify({ run }),
    }),
  update: (id: number, run: any) =>
    request<{ ok: boolean; id: number }>(`/history/${id}`, {
      method: 'PUT', body: JSON.stringify({ run }),
    }),
};

export default { auth, data, saves, history };
