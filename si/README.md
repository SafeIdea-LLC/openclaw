# SafeIdea patched OpenClaw releases

How we carry fixes (continuation for Codex / Claude / agents, etc.) that aren't upstream yet,
build them once, and roll the same build out to every OpenClaw instance.

This file lives on the orphan branch **`releases/template`** together with:

| File                               | Purpose                                                                                |
| ---------------------------------- | -------------------------------------------------------------------------------------- |
| `.github/workflows/si-release.yml` | CI: build on push to `release/**`, publish a GitHub Release on tag `v*-si.*`           |
| `si/update.sh`                     | Per-release installer: backup → install → doctor → restart → verify, with `--rollback` |
| `si/RELEASE_NOTES.md`              | Release body template (base tag + carried patches)                                     |
| `si/README.md`                     | This guide                                                                             |

Release tooling stays on `release/*` and `releases/template`, not `main`, `si/main`, or upstream PR branches.

---

## Branch model

| Branch                   | Contents                                                                                                         | Pushed to                                  |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `main`                   | Mirror of `upstream/main` — no local commits                                                                     | origin                                     |
| `si/main`                | Maintained integration fork: upstream main plus our active patches; merge upstream, do not rebase shared history | origin only                                |
| `fix/<topic>-<yyyymmdd>` | Focused upstream contribution; refresh when reviewers request it or when actively pursuing landing               | contributor fork → PR to openclaw/openclaw |
| `release/<base>-si`      | Upstream release tag + cherry-picked fixes + this tooling                                                        | origin only                                |
| `releases/template`      | Orphan branch with only the tooling files                                                                        | origin only                                |

Examples below use `origin` = `SafeIdea-LLC/openclaw`, `upstream` = `openclaw/openclaw`. Check `git remote -v` first: some existing checkouts use `safeidea` for the fork and `origin` for upstream. Never rename shared remotes just to follow these examples.

## Maintain the fork independently of upstream PRs

Our shipping path does not wait for upstream review or acceptance. Keep continuation and app branding together on `si/main`; keep their upstream PRs separate and leave their existing heads untouched unless review or active upstream work requires a refresh.

At a deliberate integration checkpoint, in an exclusive clean worktree:

```bash
git fetch upstream main
git switch si/main
git merge --no-ff upstream/main
# Resolve conflicts, preserving upstream fixes; run affected checks and review.
git push origin si/main
```

Pin the fetched SHA in the task evidence. If upstream rewrites history or Git cannot establish ancestry, investigate before merging; never use `--allow-unrelated-histories` or force-push the shared fork as a routine recovery. A merge preserves our history, but still needs semantic conflict review.

Release candidates start from a chosen stable tag, not a moving `si/main` tip. Carry only still-missing fixes from the integration branch or retained feature commits. Record their source SHAs and any adaptations in `si/RELEASE_NOTES.md`. Upstream may squash or independently implement a fix: `git cherry` is an aid, not proof that behavior is absent.

Freeze the candidate while qualifying it. New upstream releases alone do not restart qualification; reconsider for a relevant security fix or a demonstrated blocker. Review upgrades on a regular cadence (normally weekly), not on every upstream push. Do not install directly from `si/main`.

## Versioning

`<next upstream patch>-si.<n>` — e.g. a build on top of upstream **v2026.11.3** is **2026.11.4-si.1**, `-si.2`, …

- Sorts **above** stock 2026.11.3, so update checks never "upgrade" you back to stock.
- Sorts **below** the real 2026.11.4, so when upstream ships it, it correctly looks newer — that is an upgrade signal, not an instruction to discard an in-flight candidate. The operator selects the next release on the agreed cadence.
- The git tag is the version with a `v`: `v2026.11.4-si.1`. CI refuses a tag that doesn't match `package.json`.
- Branch name and release notes record the _real_ base (`release/2026.11.3-si`, "Base: v2026.11.3").

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

Need another change? Repair it on `si/main` when applicable, port the fix to the frozen release branch, push, and re-test. Updating the upstream PR is independent work, not a prerequisite.
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

The agents on each instance should _run_ `update.sh`, never build OpenClaw themselves.

## 6. At the next chosen upgrade checkpoint

```bash
git fetch upstream --tags
BASE=v2026.11.4
git switch -c release/${BASE#v}-si $BASE
git cherry -v $BASE release/2026.11.3-si    # "+" lines = patches still to carry
```

Inspect the remaining behavioral differences, not just the "+" list. Drop patches only after verifying equivalent behavior in the selected released source and retaining regression coverage. Port the remaining fixes, copy the tooling (step 2), and choose the next `-si.N` version. Preserve the preceding qualified candidate as a fallback; do not rebase it in place.

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
