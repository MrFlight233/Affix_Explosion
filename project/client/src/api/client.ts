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
  uploadBD: (floor:number, round:number, bd:any, power_score:number) =>
    request<{id:number}>('/data/battle-pool', {
      method:'POST', body:JSON.stringify({floor,round,bd_json:JSON.stringify(bd),power_score}),
    }),
  getBattlePool: (floor:number, round:number) =>
    request<{opponents:any[]}>('/data/battle-pool?' + new URLSearchParams({floor:String(floor),round:String(round)})),
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
