'use strict';
// Capture references before jest.resetModules() removes the module cache.
function captureCleanup() {
  const loaded = name => require.cache[require.resolve(name)]?.exports;
  const writer=loaded('../src/db/writer'),security=loaded('../src/realtime/securityEvents'),blacklist=loaded('../src/utils/tokenBlacklist'),cache=loaded('../src/utils/cache'),limiters=loaded('../src/middleware/rateLimiters');
  const tracing=loaded('../src/integrations/tracing'),fcm=loaded('../src/utils/fcmOptimized'),audit=loaded('../src/utils/auditLogger'),query=loaded('../src/utils/queryOptimizer');
  return async()=>{
    tracing?.stopCleanup?.();fcm?.stopCleanup?.();audit?.auditLogger?.stopCleanup?.();query?.queryCache?.stopCleanup?.();
    await writer?.shutdown?.();await security?.close?.();await blacklist?.close?.();await cache?.close?.();await limiters?.close?.();
  };
}
module.exports={captureCleanup};
