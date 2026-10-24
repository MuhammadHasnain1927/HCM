import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorMessage } from './api.js';

/**
 * Loads data from the API: const { data, loading, error, reload } = useApi('/org/departments', { params }).
 * Pass url = null to skip loading. Stale responses are ignored when params change.
 */
export function useApi(url, { params } = {}) {
  const [state, setState] = useState({ data: null, loading: Boolean(url), error: null });
  const paramsKey = JSON.stringify(params ?? {});
  const requestId = useRef(0);

  const load = useCallback(async () => {
    if (!url) return;
    const id = ++requestId.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const { data } = await api.get(url, { params: JSON.parse(paramsKey) });
      if (id === requestId.current) setState({ data, loading: false, error: null });
    } catch (err) {
      if (id === requestId.current) setState((s) => ({ ...s, loading: false, error: errorMessage(err) }));
    }
  }, [url, paramsKey]);

  useEffect(() => {
    load();
  }, [load]);

  return { ...state, reload: load, setData: (data) => setState((s) => ({ ...s, data })) };
}
