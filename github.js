// Tarayıcıdan GitHub REST çağrıları. Token telefonda (localStorage) durur, yalnız
// api.github.com'a gider; uygulamanın kendi sunucusu yoktur.
const API = 'https://api.github.com';

export function client({ token, repo }) {
  async function call(method, endpoint, body) {
    const res = await fetch(`${API}/repos/${repo}/${endpoint}`, {
      method,
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const hint = res.status === 401 ? 'token geçersiz ya da süresi dolmuş'
        : res.status === 403 || res.status === 404 ? 'token bu depoya erişemiyor (Issues: Read and write izni gerekli)'
          : err.message ?? res.statusText;
      throw Object.assign(new Error(`GitHub ${res.status}: ${hint}`), { status: res.status, body: err });
    }
    return res.status === 204 ? null : res.json();
  }

  return {
    call,
    /** Bütün issue'lar (açık ve kapalı), pull request'ler hariç. */
    async listIssues() {
      const all = [];
      for (let page = 1; ; page++) {
        const batch = await call('GET', `issues?state=all&per_page=100&page=${page}`);
        all.push(...batch);
        if (batch.length < 100) break;
      }
      return all.filter((i) => !i.pull_request);
    },
    getIssue: (n) => call('GET', `issues/${n}`),
    createIssue: (fields) => call('POST', 'issues', fields),
    updateIssue: (n, fields) => call('PATCH', `issues/${n}`, fields),
    listComments: (n) => call('GET', `issues/${n}/comments?per_page=100`),
    addComment: (n, body) => call('POST', `issues/${n}/comments`, { body }),
    /** Etiket yoksa açar; varsa GitHub 422 döner, yok sayılır. */
    async ensureLabel(name, color, description) {
      await call('POST', 'labels', { name, color, description }).catch((err) => {
        if (err.status !== 422) throw err;
      });
    },
  };
}
