// Vitest の複数の記録形式を、従来と同じ優先順で失敗数へ読み替える。
const failedState = new Set(['fail', 'failed', 'error', 'errors', 'broken']);
const resultState = (value) => String(value ?? '').toLowerCase();
export function vitestFailureCount(data) {
  const files = Array.isArray(data?.results) ? data.results
    : Array.isArray(data?.testResults) ? data.testResults
      : Array.isArray(data?.files) ? data.files
        : data?.results && typeof data.results === 'object' ? Object.values(data.results) : null;
  const failedResult = (value) => {
    if (value === true) return true;
    if (Array.isArray(value)) return value[1] === true;
    if (!value || typeof value !== 'object') return false;
    if (value.failed === true) return true;
    const state = resultState(value.state ?? value.status ?? value.result?.state ?? value.result?.status);
    const assertions = Array.isArray(value.assertionResults) ? value.assertionResults
      : Array.isArray(value.tests) ? value.tests : [];
    return failedState.has(state) || assertions.some((t) => failedState.has(resultState(t?.status ?? t?.state ?? t?.result)));
  };
  if (files) {
    let failures = files.reduce((n, f) => n + (failedResult(f) ? 1 : 0), 0);
    if (!failures && Number.isFinite(data?.numFailedTestSuites)) failures = Math.max(0, Math.floor(data.numFailedTestSuites));
    if (!failures && Number.isFinite(data?.failedFiles)) failures = Math.max(0, Math.floor(data.failedFiles));
    if (!failures && data?.success === false) failures = 1;
    return failures;
  }
  if (data?.failed === true) return 1;
  if (Number.isFinite(data?.numFailedTestSuites)) return Math.max(0, Math.floor(data.numFailedTestSuites));
  if (Number.isFinite(data?.numFailedFiles)) return Math.max(0, Math.floor(data.numFailedFiles));
  if (Number.isFinite(data?.numFailedTests)) return Math.max(0, Math.floor(data.numFailedTests));
  if (data && typeof data.success === 'boolean') return data.success ? 0 : 1;
  return null;
}
