export type GitFile = {
  path: string;
  original_path?: string | null;
  kind: string;
  index_status?: string;
  worktree_status?: string;
};

export type Branch = {
  name: string;
  full_name: string;
  current: boolean;
  remote: boolean;
  upstream?: string | null;
  tracking?: string | null;
};

export type Stash = {
  ref: string;
  oid: string;
  message: string;
};

export type Commit = {
  oid: string;
  short_oid: string;
  parent_oids: string[];
  subject: string;
  author: string;
  authored_at: string;
  refs: string[];
};

export type PortConflict = {
  port: number;
  pid: number;
  process_name?: string | null;
  replaceable: boolean;
  command: string;
  family?: string | null;
};

export type TerminalState = {
  running: boolean;
  command?: string | null;
  output: string;
  exit_status?: number | null;
  port_conflict?: PortConflict | null;
};

export type Repository = {
  id: string;
  name: string;
  path: string;
  head?: string | null;
  oid?: string | null;
  unborn: boolean;
  detached: boolean;
  upstream?: string | null;
  remote?: string | null;
  ahead: number;
  behind: number;
  staged: GitFile[];
  unstaged: GitFile[];
  untracked: GitFile[];
  conflicted: GitFile[];
  branches: Branch[];
  remotes: string[];
  stashes: Stash[];
  commits: Commit[];
  operation_state?: "merge" | "rebase" | null;
  busy?: string | null;
  last_error?: string | null;
  last_notice?: string | null;
  terminal?: TerminalState;
};

export type WorkspaceState = {
  repositories: Repository[];
  recents: string[];
  workspace_error?: string | null;
};

export type DiffResult = {
  id: string;
  file: string;
  staged: boolean;
  binary: boolean;
  truncated: boolean;
  limit: number;
  content: string;
};

export type FileTreeResult = {
  id: string;
  files: string[];
};

export type FileSearchResult = {
  id: string;
  query: string;
  files: string[];
};
export type FileContentResult = {
  id: string;
  path: string;
  content: string;
  size: number;
  mtime?: string | null;
};

export const emptyWorkspace: WorkspaceState = {
  repositories: [],
  recents: [],
  workspace_error: null
};
