/**
 * CAS 登录后的回跳目标。
 *
 * 后端 `service` 参数固定用配置的应用地址、不接受外部传入（防开放重定向，见
 * auth.controller.ts），所以 returnTo 只能在**前端**用 sessionStorage 携带。
 * 这是「公开课程页 → 点申请 → CAS 登录 → 回到那门课」这条主干路径的关键。
 */
const RETURN_TO_KEY = 'nju-lab:return-to';

/** 记录登录后要回到的站内路径（不含 basename） */
export function rememberReturnTo(path: string) {
  try {
    if (path && path !== '/login' && path !== '/login/cas') {
      sessionStorage.setItem(RETURN_TO_KEY, path);
    }
  } catch {
    // 隐私模式下 sessionStorage 可能不可用，忽略
  }
}

/** 读取并清除回跳目标；无则返回 null */
export function consumeReturnTo(): string | null {
  try {
    const value = sessionStorage.getItem(RETURN_TO_KEY);
    sessionStorage.removeItem(RETURN_TO_KEY);
    return value && value.startsWith('/') ? value : null;
  } catch {
    return null;
  }
}

/** 只读，用于登录页提示 */
export function peekReturnTo(): string | null {
  try {
    return sessionStorage.getItem(RETURN_TO_KEY);
  } catch {
    return null;
  }
}
