# OpenClaw 2026.11.9-si.1 — candidate

**Base:** upstream `v2026.11.8` (`2d4ab292114df2ab9670c91c9b846f701c565bd7`).

This frozen candidate combines continuation repairs and gateway-wide installed-app branding. It is separate from the rolling `si/main` integration branch. A newer upstream release alone does not invalidate this candidate.

## Carried patches

- Continuation: pending completion custody retains the native tool catalog; terminal tools wait for native output receipts before interrupting. Source: [upstream PR #184848](https://github.com/openclaw/openclaw/pull/184848), head `205d6d97ed2664ac714b827e35bbd824de015d8b`; ported from reviewed 11.5 backport `f7c292ee005db8737dbe5a316b7d47f3db3ed1ef`.
- Detached announcements leave the originating admitted scope before preparing their continuation. This repair is still needed on 11.8; the rolling upstream integration already has an equivalent broader scope owner.
- PWA branding: `gateway.controlUi.appIdentity` supports public name, short name, PNG icon, theme color, and background color. Source: `148ef1b8083e7aa7bccd82ef2182befd4485e57c`, adapted to the 11.8 HTML renderer. The installed manifest endpoint survives branding removal, identity remains stable, and personal tab-icon choices remain independent.

11.8 already includes the sibling-completion retention repair. Its implementation is retained rather than reintroducing the older fork helper.

## Qualification

Local qualification: 121 distinct focused tests pass (71 continuation, 2 parent-retention, 12 config, 11 UI, 9 HTTP branding, 8 HTTP metadata, 8 gateway authority), with successful final wrapper exits. After the mechanical size-limit extractions, reran all affected retention/catalog/custody and branding/HTTP-metadata suites; core and extension types and core lint were rerun successfully. Core/UI/extension typechecks and targeted core lint pass. Independent source review found no remaining P0–P2 findings after the renderer adaptation. Extension lint did not execute: SDK declaration preparation exceeded its 300-second limit. Full package and live/browser proof remain outstanding.

This is a CI candidate, not an installed or published release. Build only in CI; deploy the same artifact to a separately authorized canary before rollout. Full build, real continuation smoke, and installed-PWA refresh/upgrade behavior must be verified before release. Browsers may require reinstalling an app to refresh launcher branding.

The existing 11.5 combined candidate remains untouched as a fallback. No upstream PR is rebased or closed by this release branch. The known branding source is a saved feature commit; no matching published branding PR was found during preparation.

Release tooling is copied from `releases/template` at `1cb73a344c687f799673478707de7384868b7efb`; its workflow and installer are unchanged. The branch-policy documentation update is proposed separately in [fork PR #4](https://github.com/SafeIdea-LLC/openclaw/pull/4).

No tag, public release, instance installation, or gateway restart is authorized by this candidate alone.
