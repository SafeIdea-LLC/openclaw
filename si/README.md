# SafeIdea patched OpenClaw releases

How we carry fixes (continuation for Codex / Claude / agents, etc.) that aren't upstream yet,
build them once, and roll the same build out to every OpenClaw instance.

This file lives on the orphan branch **`releases/template`** together with:

| File | Purpose |
|---|---|
| `.github/workflows/si-release.yml` | CI: build on push to `release/**`, publish a GitHub Release on tag `v*-si.*` |
| `si/update.sh` | Per-release installer: backup → install → doctor → restart → verify, with `--rollback` |
| `si/RELEASE_NOTES.md` | Release body template (base tag + carried patches) |
| `si/README.md` | This guide |

Nothing here ever goes into `main` or a `fix/*` branch, so upstream PRs stay clean.

---

## Branch model

| Branch | Contents | Pushed to |
|---|---|---|
| `main` | Mirror of `upstream/main` — no local commits | origin |
| `fix/<topic>-<yyyymmdd>` | One fix, based on `upstream/main`, = one upstream PR | origin → PR to openclaw/openclaw |
| `release/<base>-si` | Upstream release tag + cherry-picked fixes + this tooling | origin only |
| `releases/template` | Orphan branch with only the tooling files | origin only |

Remotes: `origin` = `SafeIdea-LLC/openclaw`, `upstream` = `openclaw/openclaw`.

## Versioning

`<next upstream patch>-si.<n>` — e.g. a build on top of upstream **v2026.11.3** is **2026.11.4-si.1**, `-si.2`, …

- Sorts **above** stock 2026.11.3, so update checks never "upgrade" you back to stock.
- Sorts **below** the real 2026.11.4, so when upstream ships it, it correctly looks newer — that's the cue to cut a new release branch.
- The git tag is the version with a `v`: `v2026.11.4-si.1`. CI refuses a tag that doesn't match `package.json`.
- Branch name and release notes record the *real* base (`release/2026.11.3-si`, "Base: v2026.11.3").

---

## 1. Make a fix (for upstream)

```bash
git fetch upstream
git switch -c fix/<topic>-$(date +%Y%m%d) upstream/main
# ... commit the fix + tests ...
git push -u origin HEAD
gh pr create -R openclaw/openclaw --head SafeIdea-LLC:fix/<topic>-<date>
```
Keep each fix small and self-contained — it has to cherry-pick cleanly onto release tags too.

## 2. Cut a release branch

```bash
git fetch upstream --tags
BASE=v2026.11.3
git switch -c release/${BASE#v}-si $BASE
```

Pick the fixes that upstream hasn't merged into `$BASE` yet:

```bash
# commits on a fix branch that are NOT already in the base ("+" = still needed, "-" = upstream has it)
git cherry -v $BASE origin/fix/<topic>-<date>
git cherry-pick <sha>...            # only the "+" ones
```

Add the tooling from the template:

```bash
git fetch origin releases/template
git checkout origin/releases/template -- .github/workflows/si-release.yml si/
```

Set the version and notes:

```bash
npm pkg set version=2026.11.4-si.1        # next upstream patch + -si.1
# edit si/RELEASE_NOTES.md: version, base tag, list of carried PRs
git add -A && git commit -m "si: release tooling + version 2026.11.4-si.1"
git push -u origin HEAD
```

## 3. Build and test (every push)

Each push to `release/**` builds a tarball as a 7-day workflow artifact — nothing is published.

```bash
gh run list -R SafeIdea-LLC/openclaw -w si-release -L 3
gh run download <run-id> -R SafeIdea-LLC/openclaw -D /tmp/si-build
# on ONE test instance:
bash /tmp/si-build/update.sh --tarball /tmp/si-build/openclaw-2026.11.4-si.1.tgz
```
Smoke test: `openclaw gateway status --deep`, then a real continuation run with Codex and Claude.

Need another change? Commit on the release branch (or better, on the fix branch and re-cherry-pick), push, test again.
Bump `-si.N` only when you're about to tag.

## 4. Publish (tag)

```bash
git tag v2026.11.4-si.1
git push origin v2026.11.4-si.1
```
CI attaches `openclaw-<v>.tgz`, `.sha256` and a stamped `update.sh` to the GitHub Release.

## 5. Roll out to instances

```bash
gh release download v2026.11.4-si.1 -R SafeIdea-LLC/openclaw -p update.sh
bash update.sh --dry-run     # look first
bash update.sh
```
`update.sh` stops the gateway, takes a `--no-include-workspace` backup, installs the tarball,
runs the bundled-plugin postinstall (npm skips lifecycle scripts for local tarballs),
`doctor --fix`, `gateway install --force`, starts and checks `status --deep`, and keeps the
last 3 builds/backups. If anything fails: `bash update.sh --rollback`.

The agents on each instance should *run* `update.sh`, never build OpenClaw themselves.

## 6. When upstream ships a new release

```bash
git fetch upstream --tags
BASE=v2026.11.4
git switch -c release/${BASE#v}-si $BASE
git cherry -v $BASE release/2026.11.3-si    # "+" lines = patches still to carry
```
Re-apply the "+" fixes, copy the tooling (step 2), set `2026.11.5-si.1`. Every fix merged
upstream simply disappears from the list — that's the goal.

## Updating the template itself

```bash
git worktree add ../openclaw-si-template releases/template
# edit, commit, push from that worktree; then refresh open release branches with:
git checkout origin/releases/template -- .github/workflows/si-release.yml si/update.sh si/README.md
```

---

## Housekeeping (lessons learned)

- **Don't build on the instances.** Each build tree is 5–10 GB (source, `node_modules`, `dist`, git history).
  A VM accumulated ~300 GB / ~19.5 M files of old patch builds in the agent workspace, which made
  `openclaw backup create` run out of memory and `du` never finish.
- If you must build locally, keep only the last two build trees and delete `node_modules`/`dist` from old ones.
- Back up with `--no-include-workspace`; the workspace is either in git or disposable.
- On libvirt VMs keep `discard='unmap'` on the disk and `fstrim.timer` enabled so deletions return space to the host.
- `openclaw worktrees list` only knows registered worktrees — check `~/.openclaw/worktrees` for orphans.
