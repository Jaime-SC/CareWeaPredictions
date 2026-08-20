# ParleyLab coding rules (Ponytail)

Standards extracted from [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail) and enforced via:

- `.cursor/rules/ponytail.mdc` (always-on Cursor rule)
- `.cursorrules` (root consolidation for agents)
- ESLint (`@typescript-eslint/no-explicit-any`)

Ponytail is **not** a performance library or ESLint plugin pack. It is a decision ladder that cuts over-engineering while keeping safety intact.

## Versionar en el repo (cualquier PC)

Tras `git pull`, Cursor aplica Ponytail solo si estos archivos están en el remoto:

- `.cursor/rules/ponytail.mdc`
- `.cursorrules`
- `RULES.md`
- `CONTRIBUTING.md`

`.gitignore` ignora el resto de `.cursor/` (estado local) pero **permite** `.cursor/rules/`.
`AGENTS.md` no se versiona (Next lo regenera).

## The ladder

1. YAGNI — does it need to exist?
2. Reuse — already in this repo?
3. Stdlib
4. Native platform
5. Installed dependency
6. One-liner
7. Minimum custom code

Read and trace first. Then climb.

## Do

- Smallest correct diff after understanding the flow
- Delete dead exports, unused deps, and no-op wrappers
- Share helpers already in `lib/` instead of copying
- Leave one smoke/assert script for non-trivial logic (`scripts/verify-*.ts`)
- Tag deliberate shortcuts: `// ponytail: <ceiling>, <upgrade when>`

## Don't

- Add dependencies for what a few lines or the platform already do
- Invent abstractions “for later”
- Patch symptoms in every caller when one shared guard fixes the root
- Skip validation, security, or data-loss handling to save lines

## Hot modules

| Area | Expectation |
|------|-------------|
| `lib/poisson.ts` | Precompute PMFs; aggregate markets in one matrix pass; one weights load per estimate |
| `lib/auto-tuner.ts` | Load only settled WON/LOST for calibration; keep EMA/sample gates |
| UI / API | No Node `fs` pulled into client bundles; keep value badges self-contained |

## Review tags (ponytail-review)

When auditing diffs, prefer one line per finding:

- `delete:` · `stdlib:` · `native:` · `yagni:` · `shrink:`

End with `net: -<N> lines possible` or `Lean already. Ship.`

## Intensity

Default **full**. Session switches: `ponytail lite|full|ultra`, `stop ponytail` / `normal mode`.
