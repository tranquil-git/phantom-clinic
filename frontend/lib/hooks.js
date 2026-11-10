'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from './api';

export const UserContext = createContext(null);
export const useUser = () => useContext(UserContext);

// Tải dữ liệu GET; path = null thì chưa tải
export function useApi(path) {
  const [state, setState] = useState({ data: null, error: null, loading: Boolean(path) });
  const load = useCallback(async () => {
    if (!path) return;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      setState({ data: await api(path), error: null, loading: false });
    } catch (err) {
      setState({ data: null, error: err.message, loading: false });
    }
  }, [path]);
  useEffect(() => { load(); }, [load]);
  return { ...state, reload: load };
}

// Gọi API ghi dữ liệu kèm trạng thái đang gửi / lỗi / thông báo thành công
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [ok, setOk] = useState(null);
  const run = useCallback(async (fn, successMessage) => {
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      const result = await fn();
      if (successMessage) setOk(successMessage);
      return result;
    } catch (err) {
      setError(err.message);
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, ok, run, setError, setOk };
}
