import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Result, Spin } from 'antd';
import client from '../../api/client';
import type { User } from '../../types';
import { useAuthStore } from '../../stores/auth';
import { consumeReturnTo } from '../../session';

/**
 * CAS 回调落地页：从 URL 取 token → 拉取当前用户 → 写入登录态 → 进首页。
 *
 * 回跳目标取自 sessionStorage：后端 service 参数固定不接受外部传入
 * （防开放重定向），所以「在课程页点申请 → 登录 → 回到那门课」只能靠前端携带。
 */
export default function CasCallback() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = params.get('token');
    if (!token) {
      setError('统一认证回调缺少 token');
      return;
    }
    client
      .get<unknown, User>('/me', { headers: { Authorization: `Bearer ${token}` } })
      .then((user) => {
        setAuth(token, user);
        const returnTo = consumeReturnTo();
        navigate(
          returnTo ??
            (user.role === 'teacher' || user.role === 'admin'
              ? '/teacher/dashboard'
              : '/student/courses'),
          { replace: true },
        );
      })
      .catch(() => setError('登录态获取失败，请重试'));
  }, [params, navigate, setAuth]);

  if (error) {
    return (
      <Result
        status="error"
        title="统一认证登录失败"
        subTitle={error}
        extra={<a href="/login">返回登录页</a>}
      />
    );
  }
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Spin size="large" tip="正在完成统一认证登录…">
        <div style={{ width: 240, height: 80 }} />
      </Spin>
    </div>
  );
}
