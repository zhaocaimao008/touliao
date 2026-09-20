// HTTP 200 only means the request was processed. Result cells define delivery.
export function normalizeForwardResult(result) {
  if (!Array.isArray(result?.target_results) || !result.target_results.length) return result;
  const ok = result.target_results.filter(item => item.status === 'success').length;
  const failed = result.target_results.length - ok;
  return {
    ...result,
    status: failed === 0 ? 'success' : ok > 0 ? 'partial_success' : 'failed',
    target_success_count: ok,
    target_failed_count: failed,
  };
}
