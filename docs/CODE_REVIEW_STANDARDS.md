# Code Review Standards
## PWRI Plant Monitoring

**Version:** 1.0  
**Effective:** 2026-09-09  
**Review Cycle:** Quarterly  

---

## Purpose
These standards ensure code quality, maintainability, and knowledge sharing. They apply to all Pull Requests targeting `main` and `staging` branches.

---

## Mandatory Requirements (PR Blockers)

### 1. File Size Limits
| Type | Hard Limit | Soft Limit | Action |
|------|------------|------------|--------|
| Component (`.tsx`) | 500 lines | 300 lines | Split into sub-components |
| Hook (`.ts`) | 300 lines | 200 lines | Extract logic to utilities |
| Utility (`.ts`) | 400 lines | 250 lines | Split by domain |
| Test file | 500 lines | 300 lines | Split by feature |

**Enforcement:** CI fails if any modified file exceeds hard limit.

### 2. Test Requirements
| Change Type | Required Tests |
|-------------|----------------|
| New component | Unit tests for props/rendering |
| New hook | Unit tests for all return values |
| New utility | Unit tests for all exported functions |
| API/data layer | Integration tests with Supabase mocks |
| Bug fix | Regression test for the specific bug |
| Refactor | Existing tests must pass + new tests for changed behavior |

**Coverage:** New code must have ≥80% line coverage.

### 3. TypeScript Standards
- No `any` types in new code (use `unknown` + type guards)
- No `@ts-ignore` or `@ts-expect-error` without comment explaining why
- All new files must pass `tsc --noEmit -p tsconfig.app.json`
- Enable next strict flag when current flag is clean for 2 sprints

### 4. ESLint Standards
- Zero errors allowed (CI fails on any error)
- Warning ceiling: must not increase without explicit ceiling update
- No new `eslint-disable` comments without justification
- Prefer fixing the rule over disabling it

### 5. File Organization
```
src/
  components/          # Reusable UI components
    ui/                # Base components (Button, Input, etc.)
    domain/            # Domain-specific components
  pages/               # Page-level components (routes)
    domain/            # Page components grouped by domain
  data/
    queries/           # Pure query functions
    mutations/         # Pure mutation functions
    hooks/             # React Query wrappers
  hooks/               # Shared React hooks
  lib/                 # Pure utilities (no React)
  store/               # Zustand stores (domain-scoped)
```

### 6. Naming Conventions
| Type | Convention | Example |
|------|------------|---------|
| Components | PascalCase | `WellReadingCard.tsx` |
| Hooks | `use` + PascalCase | `useWellReadings.ts` |
| Query functions | `fetch` + PascalCase | `fetchWellReadings.ts` |
| Mutation functions | Verb + PascalCase | `createWellReading.ts` |
| Types/Interfaces | PascalCase | `WellReadingData` |
| Constants | UPPER_SNAKE_CASE | `MAX_RETRIES` |
| CSS Classes | kebab-case | `well-reading-card` |

---

## Review Process

### 1. Self-Review (Author)
Before requesting review, author must:
- [ ] Run `npm run lint` and fix all errors
- [ ] Run `npm run typecheck` and fix all errors
- [ ] Run `npm test` and ensure all tests pass
- [ ] Run `npm run build` and verify no build errors
- [ ] Check file sizes (no files > 500 lines)
- [ ] Add tests for new functionality
- [ ] Update documentation if API changed
- [ ] Write clear PR description with:
  - What changed
  - Why it changed
  - How to test
  - Screenshots for UI changes

### 2. Reviewer Checklist
- [ ] Code follows project conventions (naming, structure)
- [ ] Types are correct and specific (no `any`)
- [ ] No unnecessary complexity
- [ ] Tests are meaningful (not just coverage)
- [ ] Error handling is appropriate
- [ ] Performance considerations addressed
- [ ] Security implications considered
- [ ] Documentation updated if needed

### 3. Approval Requirements
| Risk Level | Required Approvals |
|------------|-------------------|
| Low (docs, styling, minor fix) | 1 reviewer |
| Medium (new feature, refactor) | 2 reviewers |
| High (auth, payments, migrations) | 2 reviewers + tech lead |
| Critical (security, data loss risk) | 2 reviewers + tech lead + security review |

---

## Automated Enforcement (CI)

### Current Checks
- ✅ TypeScript type-check (`tsc --noEmit`)
- ✅ ESLint (errors fail, warnings at ceiling)
- ✅ Unit tests (Vitest)
- ✅ Build (Vite production)
- ✅ Bundle size ceiling
- ✅ Theme contrast check
- ✅ Font size scale check
- ✅ E2E smoke tests (Playwright)
- ✅ RLS policy tests (pgTAP)

### To Be Added
- [ ] File size limit check
- [ ] Test coverage threshold (80%)
- [ ] `any` type detection
- [ ] Bundle size regression alert
- [ ] Dependency vulnerability scan (npm audit)
- [ ] CodeQL security scan

---

## Sprint Definition of Done

A story is **not done** until:
- [ ] All code review requirements met
- [ ] All CI checks pass
- [ ] Deployed to staging and validated
- [ ] E2E tests pass against staging
- [ ] Documentation updated
- [ ] No new lint warnings (or ceiling updated with reason)
- [ ] No new TypeScript errors
- [ ] Bundle size within budget

---

## Exceptions

Exceptions require:
1. Written justification in PR description
2. Approval from tech lead
3. Follow-up ticket to address technical debt
4. Expiration date (max 2 sprints)

---

## Continuous Improvement

- Review these standards quarterly
- Track metrics: PR cycle time, defect rate, review throughput
- Adjust limits based on team velocity and codebase health
- Automate more checks to reduce manual review burden

---

## Quick Reference: Common Patterns

### ✅ Good: Data Layer Query
```typescript
// data/queries/wells.ts
export async function fetchWellsForPlant(plantId: string): Promise<Well[]> {
  const { data, error } = await supabase
    .from('wells')
    .select('*')
    .eq('plant_id', plantId)
    .order('name');
  if (error) throw error;
  return data ?? [];
}
```

### ✅ Good: React Query Hook
```typescript
// data/hooks/useWells.ts
export function useWellsForPlant(plantId: string) {
  return useQuery({
    queryKey: queryKeys.wells.list(plantId),
    queryFn: () => fetchWellsForPlant(plantId),
    staleTime: 60_000,
  });
}
```

### ✅ Good: Component Using Hook
```typescript
// pages/plants/wells/WellsList.tsx
export function WellsList({ plantId }) {
  const { data: wells, isLoading } = useWellsForPlant(plantId);
  // ...
}
```

### ❌ Bad: Inline Supabase Call in Component
```typescript
// DON'T DO THIS
const { data: wells } = useQuery({
  queryKey: ['wells', plantId],
  queryFn: async () => (await supabase.from('wells').select('*').eq('plant_id', plantId)).data,
});
```

---

*Document maintained by Platform Team. Last updated: 2026-09-09*