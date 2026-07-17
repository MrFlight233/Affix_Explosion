import { Request, Response, NextFunction } from 'express';
import { authMiddleware, AuthRequest } from './auth';
import { CONFIG } from '../config';

export type { AuthRequest };

/**
 * 管理员中间件：先验证 JWT，再检查用户名是否在管理员白名单中
 */
export function adminMiddleware(req: AuthRequest, res: Response, next: NextFunction): void {
  authMiddleware(req, res, () => {
    // authMiddleware 在失败时已发送 401 并结束，走到这里说明 JWT 有效
    if (!req.username || !CONFIG.ADMIN_USERS.includes(req.username)) {
      res.status(403).json({ error: '需要管理员权限' });
      return;
    }
    next();
  });
}
