// JUnit の属性と要素の数え方を隔離し、既存の寛容な読み取りを保つ。
export function junitFailureCount(text) {
  const suites = [...text.matchAll(/<testsuite\b[^>]*>/gi)];
  if (suites.length) {
    let counted = false;
    const total = suites.reduce((n, m) => {
      const failures = /\bfailures\s*=\s*["'](\d+)["']/i.exec(m[0]);
      const errors = /\berrors\s*=\s*["'](\d+)["']/i.exec(m[0]);
      if (failures || errors) counted = true;
      return n + (failures ? Number(failures[1]) : 0) + (errors ? Number(errors[1]) : 0);
    }, 0);
    if (counted) return total;
  }
  if (/<testsuites?\b/i.test(text)) {
    const root = /<testsuites\b[^>]*>/i.exec(text)?.[0] || '';
    const failures = /\bfailures\s*=\s*["'](\d+)["']/i.exec(root);
    const errors = /\berrors\s*=\s*["'](\d+)["']/i.exec(root);
    if (failures || errors) return (failures ? Number(failures[1]) : 0) + (errors ? Number(errors[1]) : 0);
    return (text.match(/<failure\b/gi) || []).length + (text.match(/<error\b/gi) || []).length;
  }
  return null;
}
