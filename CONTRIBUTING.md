# Contributing to ParleyLab

## Coding standards

This project follows **Ponytail** (lazy senior / YAGNI). See [`RULES.md`](./RULES.md), [`.cursorrules`](./.cursorrules), and [`.cursor/rules/ponytail.mdc`](./.cursor/rules/ponytail.mdc).

Short version: reuse before rewrite, stdlib/platform before deps, shortest *correct* diff, delete dead code, never skip trust-boundary validation or security.

## Archivos Ponytail (versionar siempre)

Estos archivos deben ir en el repo para que Cursor aplique las mismas reglas en cualquier PC:

| Archivo | Rol |
|---------|-----|
| `.cursor/rules/ponytail.mdc` | Regla always-on de Cursor |
| `.cursorrules` | Consolidación en la raíz del proyecto |
| `RULES.md` | Documentación humana / audit tags |
| `CONTRIBUTING.md` | Esta guía |

No hace falta instalar el plugin npm de Ponytail: con un `git pull` basta.

`AGENTS.md` / `CLAUDE.md` están en `.gitignore` (los regenera Next/Claude localmente).

## Tooling

```bash
npm run lint
npm run smoke
npx tsx scripts/verify-*.ts   # module self-checks
```

- TypeScript `strict: true`
- ESLint forbids `@typescript-eslint/no-explicit-any`
- Do not re-add unused packages (`mathjs`, `date-fns`, `class-variance-authority`, `simple-statistics`, `ws`)

## PRs

Prefer small diffs that fix the root cause. If you leave a deliberate shortcut, mark it:

```ts
// ponytail: <ceiling>, <upgrade when>
```
