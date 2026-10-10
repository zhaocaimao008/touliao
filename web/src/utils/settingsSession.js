// One settings page owns one session. Only confirmed server values are cached;
// failed writes restore the entire previous snapshot, including times/ringtones.
export function createSettingsSession({ load, save, onState, onConfirmed = () => {} }) {
  let active = true;
  let request = null;
  let state = { status: 'loading', settings: null, saving: false, saveError: false };
  const publish = patch => {
    state = { ...state, ...patch };
    if (active) onState(state);
  };
  const read = data => {
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid settings response');
    return data;
  };
  return {
    async reload() {
      if (!active || state.saving) return false;
      request?.abort();
      const controller = new AbortController();
      request = controller;
      publish({ status: 'loading', settings: null, saveError: false });
      try {
        const settings = read(await load(controller.signal));
        if (!active || request !== controller) return false;
        publish({ status: 'ready', settings });
        onConfirmed(settings);
        return true;
      } catch {
        if (active && request === controller) publish({ status: 'error' });
        return false;
      } finally {
        if (request === controller) request = null;
      }
    },
    async update(key, value, extra = {}) {
      // Synchronous guard also covers repeated input events before React renders.
      if (!active || state.status !== 'ready' || state.saving) return false;
      const previous = state.settings;
      const controller = new AbortController();
      request = controller;
      publish({ settings: { ...previous, [key]: value }, saving: true, saveError: false });
      try {
        const confirmed = read(await save({ ...extra, [key]: value }, controller.signal));
        if (!active || request !== controller) return false;
        const settings = { ...previous, [key]: value, ...confirmed };
        publish({ settings, saving: false });
        onConfirmed(settings);
        return true;
      } catch {
        if (active && request === controller) publish({ settings: previous, saving: false, saveError: true });
        return false;
      } finally {
        if (request === controller) request = null;
      }
    },
    dispose() {
      active = false;
      request?.abort();
      request = null;
    },
  };
}
