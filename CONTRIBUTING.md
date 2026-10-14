# Contributing

Read [`AGENTS.md`](AGENTS.md) first: it has the rules of the codebase (zero runtime
dependencies, Bun, TDD) and how to test each layer.

## Branches

```
feature branch ──PR (squash)──> developer ──PR (merge commit)──> main ──> npm
```

| Branch | What it is | How it changes |
|---|---|---|
| `main` | what is published on npm | only through a PR **from `developer`**, merged with a merge commit |
| `developer` | features and fixes waiting for the next release | only through PRs, squashed |
| anything else | your work | push freely |

Nobody pushes to `main` or `developer` directly, force-pushes them or deletes them: GitHub
rulesets reject it (the repository admin included; they can only skip the review of a PR).

Name branches after what they do, with a prefix: `feat/rich-text-links`,
`fix/scroll-wheel-x11`, `docs/fonts-roadmap`, `chore/ci`, `perf/layout-cache`.

## Commits

The style of the history (`git log --oneline`):

- **Subject:** one line, at most 72 characters, imperative mood, capitalized, no trailing
  period, in English. It says what changes for whoever uses the framework:
  `Add RichText: a paragraph of styled spans and links`,
  `Fix a shadow drawn under its own box`, `Release 0.4.1`.
- No conventional-commit prefixes (`feat:`, `fix:`) and no `WIP`.
- **Body** (optional, after a blank line): why, what it costs, before/after numbers for
  performance. Wrap at ~80 columns.
- One subject per commit; tests and docs go in the same commit as the code they cover.

## Pull requests

- Into `developer`, from your branch. The PR is squashed, so **its title is the commit
  subject** (same rules; the `pr-title` check enforces them) and the description becomes the
  body.
- Before opening: `bun run typecheck && bun test` (+ `bun run build:native` if you touched C,
  `bun run check:snippets` if you touched README or template docs). CI runs the same on
  Ubuntu 24.04 (`test` check) and must pass.
- Fill the template: what changes, how it was tested, what cannot be tested automatically
  (screenshots looked at, keyboard typed by hand, performance numbers).
- Keep it reviewable: one subject per PR.

## Releasing

1. On a branch off `developer`: bump `version` in `package.json` (the workspace packages
   follow it when `npm:build` runs) and add the version's section to `CHANGELOG.md`
   (`## 0.5.0 (YYYY-MM-DD)`); PR `Release 0.5.0` into `developer`.
2. PR `developer` -> `main`, titled `Release 0.5.0`, merged with a merge commit (never
   squashed: `main` and `developer` must not diverge).
3. The merge runs [`publish.yml`](.github/workflows/publish.yml): tests again, builds the
   portable addon (Ubuntu 22.04 container), publishes the three packages with provenance and
   creates the `v0.5.0` tag and GitHub release with the changelog section as notes.
   A version with a prerelease suffix (`0.5.0-beta.1`) goes to the `next` dist-tag.
   Merging into `main` without a new version publishes nothing.
