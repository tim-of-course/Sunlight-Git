import type { Repository } from "./types";

export type HorizontalRect = {
  left: number;
  right: number;
};

export type RepositoryRect = {
  id: string;
  rect: HorizontalRect;
};

export type RepositoryVisibility = {
  visibleIds: string[];
  primaryId: string | null;
};

export type RepositoryScrollOptions = {
  workspaceScrollLeft: number;
  workspaceLeft: number;
  targetLeft: number;
  targetIndex: number;
  gap: number;
  maxScrollLeft: number;
};

type RepositoryChangeData = Pick<
  Repository,
  "staged" | "unstaged" | "untracked" | "conflicted"
>;

type RepositorySearchData = Pick<Repository, "id" | "name" | "path">;

export function repositoryChangeCount(repository: RepositoryChangeData) {
  return (
    repository.staged.length +
    repository.unstaged.length +
    repository.untracked.length +
    repository.conflicted.length
  );
}

export function repositoryShortName(name: string, length = 6) {
  return Array.from(name).slice(0, length).join("");
}

export function findRepositorySearchMatch(
  repositories: RepositorySearchData[],
  query: string
) {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return null;

  const nameMatch = repositories.find((repository) =>
    repository.name.toLocaleLowerCase().includes(needle)
  );
  if (nameMatch) return nameMatch.id;

  return (
    repositories.find((repository) =>
      repository.path.toLocaleLowerCase().includes(needle)
    )?.id || null
  );
}

export function repositoryVisibility(
  workspaceRect: HorizontalRect,
  repositories: RepositoryRect[]
): RepositoryVisibility {
  const visibleIds: string[] = [];
  let primaryId: string | null = null;
  let primaryVisibleWidth = 0;

  for (const repository of repositories) {
    const visibleWidth = Math.max(
      0,
      Math.min(workspaceRect.right, repository.rect.right) -
        Math.max(workspaceRect.left, repository.rect.left)
    );

    if (visibleWidth <= 0) continue;
    visibleIds.push(repository.id);

    if (visibleWidth > primaryVisibleWidth) {
      primaryVisibleWidth = visibleWidth;
      primaryId = repository.id;
    }
  }

  return { visibleIds, primaryId };
}

export function repositoryScrollLeft(options: RepositoryScrollOptions) {
  const buffer = options.targetIndex > 0 ? Math.max(0, options.gap) : 0;
  const left =
    options.workspaceScrollLeft +
    options.targetLeft -
    options.workspaceLeft -
    buffer;

  return Math.min(Math.max(left, 0), Math.max(0, options.maxScrollLeft));
}
