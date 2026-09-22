'use strict';

// Await the currently cached instance before jest.resetModules() discards it.
// Resolving a path never loads a writer (and therefore never creates a Worker).
module.exports = async function shutdownWriterBeforeModuleReset() {
  const cached = require.cache[require.resolve('../src/db/writer')];
  if (!cached) return;

  let timer;
  try {
    await Promise.race([
      cached.exports.shutdown(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(
          '[shutdownWriterBeforeModuleReset] writer.shutdown() timed out after 5000ms: Worker did not exit'
        )), 5000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};
