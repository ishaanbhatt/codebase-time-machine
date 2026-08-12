const segment = /^[A-Za-z0-9_.-]{1,100}$/;
export type RepositoryRef = { owner: string; repo: string };

export function parseRepositoryRef(input: string): RepositoryRef | null {
  const value = input.trim().replace(/\/$/, "");
  let owner: string;
  let repo: string;
  if (value.includes("://")) {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return null;
    }
    if (
      url.protocol !== "https:" ||
      url.hostname.toLowerCase() !== "github.com"
    )
      return null;
    if (url.username || url.password || url.search || url.hash) return null;
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length !== 2) return null;
    [owner, repo] = parts;
  } else {
    const parts = value.split("/");
    if (parts.length !== 2) return null;
    [owner, repo] = parts;
  }
  repo = repo.replace(/\.git$/i, "");
  if (
    !segment.test(owner) ||
    !segment.test(repo) ||
    [owner, repo].some((value) => value === "." || value === "..")
  )
    return null;
  return { owner, repo };
}

export function canonicalRepositoryKey(ref: RepositoryRef) {
  return `${ref.owner.toLowerCase()}/${ref.repo.toLowerCase()}`;
}
