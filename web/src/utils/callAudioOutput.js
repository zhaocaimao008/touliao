// A call has one output choice, shared by all current and newly joined participants.
// Serialize changes so a slower earlier setSinkId cannot overwrite the user's last choice.
export function createCallAudioOutput({ onChange = () => {}, onError = () => {} } = {}) {
  const elements = new Set();
  let selected = '';
  let disposed = false;
  let queue = Promise.resolve();
  const enqueue = task => {
    const next = queue.then(() => disposed ? undefined : task());
    queue = next.catch(() => {});
    return next;
  };
  const apply = async id => {
    const changed = new Set();
    // Include participants that arrive while a device switch is in progress.
    while (!disposed) {
      const batch = [...elements].filter(el => !changed.has(el));
      if (!batch.length) break;
      const results = await Promise.allSettled(batch.map(async el => {
        if (el.setSinkId) await el.setSinkId(id);
        else if (id) throw new Error('Audio output selection is unavailable');
      }));
      batch.forEach(el => changed.add(el));
      const failed = results.find((result, i) => result.status === 'rejected' && elements.has(batch[i]));
      if (failed) throw failed.reason;
    }
  };
  return {
    get selected() { return selected; },
    register(element) {
      elements.add(element);
      enqueue(async () => {
        if (!elements.has(element) || !selected) return;
        try { await element.setSinkId(selected); }
        catch (error) {
          if (disposed || !elements.has(element)) return;
          try { await apply(''); selected = ''; onChange(''); } catch { /* Error remains visible below. */ }
          onError(error);
        }
      });
      return () => elements.delete(element);
    },
    select(id) {
      return enqueue(async () => {
        const previous = selected;
        try {
          await apply(id);
          if (disposed) return;
          selected = id;
          onChange(id);
        } catch (error) {
          if (disposed) return;
          // Preserve the working choice if one participant could not switch.
          try { await apply(previous); }
          catch { try { await apply(''); selected = ''; onChange(''); } catch { /* Surface failure. */ } }
          onError(error);
          throw error;
        }
      });
    },
    dispose() { disposed = true; elements.clear(); },
  };
}
