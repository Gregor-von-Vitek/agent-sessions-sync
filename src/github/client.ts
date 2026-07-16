const API_BASE = 'https://api.github.com';

export class GitHubError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = 'GitHubError';
  }
}

export interface RepoInfo {
  full_name: string;
  name: string;
  owner: { login: string };
  private: boolean;
  default_branch: string;
  description: string | null;
  updated_at: string;
}

export interface TreeEntry {
  path: string;
  mode: string;
  type: string;
  /** null deletes the path when combined with base_tree. */
  sha: string | null;
}

/**
 * Minimal GitHub REST client built on global fetch — no runtime dependencies, no local git.
 * Uses the Git Data API (blobs/trees/commits/refs) for atomic multi-file commits.
 */
export class GitHubClient {
  constructor(
    private readonly token: string,
    private readonly logDebug: (msg: string) => void = () => {}
  ) {}

  private async request<T>(method: string, apiPath: string, body?: unknown): Promise<T> {
    this.logDebug(`${method} ${apiPath}`);
    let response: Response;
    try {
      response = await fetch(API_BASE + apiPath, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      throw new GitHubError(`Network error while contacting GitHub: ${e instanceof Error ? e.message : String(e)}`, 0);
    }
    if (!response.ok) {
      let message = `GitHub API ${method} ${apiPath} failed with ${response.status}`;
      try {
        const data = (await response.json()) as { message?: string };
        if (data?.message) {
          message += `: ${data.message}`;
        }
      } catch {
        // no JSON body
      }
      if (
        (response.status === 403 || response.status === 429) &&
        response.headers.get('x-ratelimit-remaining') === '0'
      ) {
        const reset = Number(response.headers.get('x-ratelimit-reset'));
        const resetText = Number.isFinite(reset) ? ` Rate limit resets at ${new Date(reset * 1000).toLocaleTimeString()}.` : '';
        message = `GitHub API rate limit exceeded.${resetText}`;
      }
      throw new GitHubError(message, response.status);
    }
    if (response.status === 204) {
      return undefined as T;
    }
    return (await response.json()) as T;
  }

  private async paginate<T>(apiPath: string, maxPages = 10): Promise<T[]> {
    const sep = apiPath.includes('?') ? '&' : '?';
    const results: T[] = [];
    for (let page = 1; page <= maxPages; page++) {
      const chunk = await this.request<T[]>('GET', `${apiPath}${sep}per_page=100&page=${page}`);
      results.push(...chunk);
      if (chunk.length < 100) {
        break;
      }
    }
    return results;
  }

  // ---- account / repositories ----

  async getAuthenticatedUser(): Promise<{ login: string }> {
    return this.request('GET', '/user');
  }

  /** Repositories the user owns or collaborates on, most recently updated first. */
  async listRepos(): Promise<RepoInfo[]> {
    return this.paginate<RepoInfo>('/user/repos?affiliation=owner,collaborator&sort=updated');
  }

  async getRepo(owner: string, repo: string): Promise<RepoInfo> {
    return this.request('GET', `/repos/${owner}/${encodeURIComponent(repo)}`);
  }

  async createRepo(name: string, description: string): Promise<RepoInfo> {
    return this.request('POST', '/user/repos', {
      name,
      description,
      private: true,
      auto_init: false,
      has_issues: false,
      has_projects: false,
      has_wiki: false,
    });
  }

  async listBranches(owner: string, repo: string): Promise<Array<{ name: string }>> {
    return this.paginate(`/repos/${owner}/${encodeURIComponent(repo)}/branches`);
  }

  /** Head commit sha of a branch, or null when the branch does not exist (missing branch or empty repo). */
  async getBranchHeadSha(owner: string, repo: string, branch: string): Promise<string | null> {
    try {
      const data = await this.request<{ commit: { sha: string } }>(
        'GET',
        `/repos/${owner}/${encodeURIComponent(repo)}/branches/${encodeURIComponent(branch)}`
      );
      return data.commit.sha;
    } catch (e) {
      if (e instanceof GitHubError && e.status === 404) {
        return null;
      }
      throw e;
    }
  }

  // ---- git data ----

  async getCommit(owner: string, repo: string, sha: string): Promise<{ treeSha: string }> {
    const data = await this.request<{ tree: { sha: string } }>(
      'GET',
      `/repos/${owner}/${encodeURIComponent(repo)}/git/commits/${sha}`
    );
    return { treeSha: data.tree.sha };
  }

  async getTreeRecursive(
    owner: string,
    repo: string,
    treeSha: string
  ): Promise<Array<{ path: string; type: string; sha: string; mode: string }>> {
    const data = await this.request<{
      tree: Array<{ path: string; type: string; sha: string; mode: string }>;
      truncated: boolean;
    }>('GET', `/repos/${owner}/${encodeURIComponent(repo)}/git/trees/${treeSha}?recursive=1`);
    if (data.truncated) {
      throw new GitHubError('Repository tree is too large to synchronize.', 422);
    }
    return data.tree;
  }

  async getBlob(owner: string, repo: string, sha: string): Promise<Buffer> {
    const data = await this.request<{ content: string; encoding: string }>(
      'GET',
      `/repos/${owner}/${encodeURIComponent(repo)}/git/blobs/${sha}`
    );
    if (data.encoding !== 'base64') {
      throw new GitHubError(`Unexpected blob encoding '${data.encoding}'`, 500);
    }
    return Buffer.from(data.content.replace(/\n/g, ''), 'base64');
  }

  async createBlob(owner: string, repo: string, content: Buffer): Promise<string> {
    const data = await this.request<{ sha: string }>('POST', `/repos/${owner}/${encodeURIComponent(repo)}/git/blobs`, {
      content: content.toString('base64'),
      encoding: 'base64',
    });
    return data.sha;
  }

  async createTree(owner: string, repo: string, entries: TreeEntry[], baseTreeSha?: string): Promise<string> {
    const data = await this.request<{ sha: string }>('POST', `/repos/${owner}/${encodeURIComponent(repo)}/git/trees`, {
      tree: entries,
      ...(baseTreeSha ? { base_tree: baseTreeSha } : {}),
    });
    return data.sha;
  }

  async createCommit(owner: string, repo: string, message: string, treeSha: string, parents: string[]): Promise<string> {
    const data = await this.request<{ sha: string }>('POST', `/repos/${owner}/${encodeURIComponent(repo)}/git/commits`, {
      message,
      tree: treeSha,
      parents,
    });
    return data.sha;
  }

  /** Fast-forward the branch ref. Throws GitHubError 422/409 when the remote moved (non-fast-forward). */
  async updateRef(owner: string, repo: string, branch: string, sha: string): Promise<void> {
    await this.request('PATCH', `/repos/${owner}/${encodeURIComponent(repo)}/git/refs/heads/${branch}`, {
      sha,
      force: false,
    });
  }

  async createRef(owner: string, repo: string, branch: string, sha: string): Promise<void> {
    await this.request('POST', `/repos/${owner}/${encodeURIComponent(repo)}/git/refs`, {
      ref: `refs/heads/${branch}`,
      sha,
    });
  }

  /**
   * Create a file via the contents API. Used only to initialize an empty repository
   * (creates the default branch with an initial commit). Returns the commit sha.
   */
  async createFileViaContents(owner: string, repo: string, filePath: string, content: Buffer, message: string): Promise<string> {
    const data = await this.request<{ commit: { sha: string } }>(
      'PUT',
      `/repos/${owner}/${encodeURIComponent(repo)}/contents/${filePath}`,
      {
        message,
        content: content.toString('base64'),
      }
    );
    return data.commit.sha;
  }
}
