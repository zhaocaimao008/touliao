import { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { createSettingsSession } from '../utils/settingsSession';

export default function useAccountSettings(onConfirmed) {
  const [state, setState] = useState({ status: 'loading', settings: null, saving: false, saveError: false });
  const sessionRef = useRef(null);
  useEffect(() => {
    const session = createSettingsSession({
      load: signal => axios.get('/api/users/me/settings', { signal }).then(response => response.data),
      save: (body, signal) => axios.put('/api/users/me/settings', body, { signal }).then(response => response.data),
      onState: setState,
      onConfirmed,
    });
    sessionRef.current = session;
    session.reload();
    return () => { session.dispose(); sessionRef.current = null; };
  }, [onConfirmed]);
  return {
    ...state,
    reload: () => sessionRef.current?.reload(),
    saveSetting: (key, value, extra) => sessionRef.current?.update(key, value, extra),
  };
}
