# SafeIdea maintained fork

`si/main` is our integration branch: upstream `main` plus the fixes and features
we need to run. Merge upstream periodically; do not routinely rebase or
force-rewrite this shared branch. Preserve upstream behavior when an equivalent
fix lands, and remove only the superseded local implementation.

Ship from a frozen `release/<base>-si` branch based on a selected stable upstream
tag, carrying the still-needed patches. Do not merge unreleased upstream `main`
into a frozen candidate merely because another version appears. Keep the prior
candidate available until its replacement is qualified.

Keep focused upstream PR branches separate from `si/main`. Refresh those when
actively pursuing upstream acceptance or responding to reviewers; upstream
acceptance is not a prerequisite for a tested fork release.

Release tooling belongs only on `releases/template` and release branches, not
on `si/main` or upstream contribution branches. Build artifacts in CI and deploy
the same verified artifact to each instance; do not build on deployment instances.
Publishing a release tag or deploying still requires explicit authorization.

See the [release guide](https://github.com/SafeIdea-LLC/openclaw/blob/releases/template/si/README.md)
and the [branch-workflow update](https://github.com/SafeIdea-LLC/openclaw/pull/4).
