// ============================================================
// API 客户端 — 封装后端 HTTP 请求
// ============================================================

const BASE = '/api';

let token: string | null = localStorage.getItem('ae_token');

export function setToken(t: string | null) {
  token = t;
  if (t) localStorage.setItem('ae_token', t);
  else localStorage.removeItem('ae_token');
}

export function getToken(): string | null { return token; }

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
    throw new Error(body.error || `HTTP ${res.status}`);
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
    request<{ entity: any }>('/admin/entities/' + encodeURIComponent(id)),
  createEntity: (entity: any) =>
    request<{ entity: any }>('/admin/entities', {
      method: 'POST', body: JSON.stringify({ entity }),
    }),
  updateEntity: (id: string, entity: any) =>
    request<{ entity: any }>('/admin/entities/' + encodeURIComponent(id), {
      method: 'PUT', body: JSON.stringify({ entity }),
    }),
  deleteEntity: (id: string) =>
    request<{ ok: boolean }>('/admin/entities/' + encodeURIComponent(id), { method: 'DELETE' }),

  // Affixes
  listAffixes: () =>
    request<{ affixes: any[]; version: number }>('/admin/affixes'),
  getAffix: (id: string) =>
    request<{ affix: any }>('/admin/affixes/' + encodeURIComponent(id)),
  createAffix: (affix: any) =>
    request<{ affix: any }>('/admin/affixes', {
      method: 'POST', body: JSON.stringify({ affix }),
    }),
  updateAffix: (id: string, affix: any) =>
    request<{ affix: any }>('/admin/affixes/' + encodeURIComponent(id), {
      method: 'PUT', body: JSON.stringify({ affix }),
    }),
  deleteAffix: (id: string) =>
    request<{ ok: boolean }>('/admin/affixes/' + encodeURIComponent(id), { method: 'DELETE' }),

  // Import batch
  importEntities: (items: any[], overwrite: boolean) =>
    request<{ imported: number; skipped: number; errors: { index: number; id: string; message: string }[] }>(
      '/admin/entities/import', { method: 'POST', body: JSON.stringify({ items, overwrite }) }
    ),
  importAffixes: (items: any[], overwrite: boolean) =>
    request<{ imported: number; skipped: number; errors: { index: number; id: string; message: string }[] }>(
      '/admin/affixes/import', { method: 'POST', body: JSON.stringify({ items, overwrite }) }
    ),

  // Clear all
  clearAllEntities: () =>
    request<{ ok: boolean; message: string }>('/admin/entities', { method: 'DELETE' }),
  clearAllAffixes: () =>
    request<{ ok: boolean; message: string }>('/admin/affixes', { method: 'DELETE' }),

  // Categories
  listCategories: () =>
    request<{ categories: any[] }>('/admin/categories'),
  createCategory: (category: any) =>
    request<{ category: any }>('/admin/categories', {
      method: 'POST', body: JSON.stringify({ category }),
    }),
  updateCategory: (id: string, category: any) =>
    request<{ category: any }>('/admin/categories/' + encodeURIComponent(id), {
      method: 'PUT', body: JSON.stringify({ category }),
    }),
  deleteCategory: (id: string) =>
    request<{ ok: boolean }>('/admin/categories/' + encodeURIComponent(id), { method: 'DELETE' }),
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

export default { auth, data, saves };
