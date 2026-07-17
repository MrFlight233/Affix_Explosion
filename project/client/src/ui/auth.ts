// ============================================================
// 登录/注册模态框
// ============================================================

import { auth, setToken } from '../api/client';

let modalResolve: ((username: string) => void) | null = null;

export function showAuthModal(onLogin: (username: string) => void) {
  modalResolve = onLogin;

  // 移除已有
  const existing = document.getElementById('auth-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'auth-modal';
  modal.innerHTML = `
    <div class="auth-box">
      <h3 style="margin-bottom:12px;font-size:16px;">登录 / 注册</h3>
      <label for="auth-username">用户名</label>
      <input id="auth-username" type="text" placeholder="输入用户名" maxlength="20" />
      <label for="auth-password">密码</label>
      <input id="auth-password" type="password" placeholder="输入密码" />
      <div class="auth-btns">
        <button class="btn" id="auth-login" style="flex:1;">登录</button>
        <button class="btn" id="auth-register" style="flex:1;">注册</button>
      </div>
      <div class="auth-error" id="auth-error"></div>
    </div>
  `;
  document.body.appendChild(modal);

  // 点击遮罩关闭
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      // 不关闭，必须登录
    }
  });

  const usernameInput = document.getElementById('auth-username') as HTMLInputElement;
  const passwordInput = document.getElementById('auth-password') as HTMLInputElement;
  const errorEl = document.getElementById('auth-error')!;

  async function handleAuth(mode: 'login' | 'register') {
    const username = usernameInput.value.trim();
    const password = passwordInput.value;
    errorEl.textContent = '';

    if (!username || !password) {
      errorEl.textContent = '请填写用户名和密码';
      return;
    }

    try {
      const result = mode === 'login'
        ? await auth.login(username, password)
        : await auth.register(username, password);
      setToken(result.token);
      modal.remove();
      if (modalResolve) modalResolve(result.user.username);
    } catch (e: any) {
      errorEl.textContent = e.message || '操作失败';
    }
  }

  document.getElementById('auth-login')!.addEventListener('click', () => handleAuth('login'));
  document.getElementById('auth-register')!.addEventListener('click', () => handleAuth('register'));
  passwordInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleAuth('login');
  });

  usernameInput.focus();
}

export function hideAuthModal() {
  const modal = document.getElementById('auth-modal');
  if (modal) modal.remove();
}
