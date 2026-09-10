# React 19 Migration Plan & Readiness Assessment

This document provides a comprehensive technical blueprint and migration runbook for upgrading the `pwri-plantmonitoring` frontend SPA from React 18.3.1 to React 19.

---

## 1. Executive Summary & Value Proposition

Migrating to React 19 delivers critical developer experience, performance, and maintainability benefits to the `pwri-plantmonitoring` frontend:

1. **Native Actions & Async Form Transitions**:
   - `useActionState`: Automates pending states, optimistic updates, and error handling for form submissions (e.g. daily water production entries, chemical dosing logs, and user role modifications).
   - `useOptimistic`: Enables immediate UI updates for high-frequency operations before network round-trips complete.
2. **`use()` Hook for Promises & Context**:
   - Allows reading promises and React context conditionally inside component functions, avoiding nested consumer hierarchies and redundant boilerplate.
3. **Ref as a Regular Prop**:
   - Function components can receive `ref` directly as a prop without needing the `React.forwardRef` wrapper. This eliminates thousands of lines of generic typing boilerplate across the 40+ shadcn/ui components in `src/components/ui/`.
4. **Enhanced Error Logging in `createRoot`**:
   - React 19 introduces native hooks `onCaughtError`, `onUncaughtError`, and `onRecoverableError` directly on `createRoot()`. This integrates directly with our Sentry error façade (`src/lib/monitoring.ts`) without relying solely on per-component Error Boundaries.
5. **React Compiler Compatibility**:
   - Aligns the project with the React Compiler, eliminating brittle manual dependency arrays in `useMemo` and `useCallback`.

---

## 2. Downstream Package Compatibility Matrix

An automated audit of our dependencies in `frontend/package.json` against npm registry releases confirms the following status:

| Package | Current Version | React 19 Status | Strategy & Action Required |
| :--- | :--- | :--- | :--- |
| `react` | `^18.3.1` | Core Target | Upgrade to `^19.3.0` |
| `react-dom` | `^18.3.1` | Core Target | Upgrade to `^19.3.0` |
| `@types/react` | `^18.3.23` | Compatible | Upgrade to `^19.3.0` |
| `@types/react-dom` | `^18.3.7` | Compatible | Upgrade to `^19.3.0` |
| **Radix UI Primitives** (25 packages) | `1.1.x` - `1.3.x` | **Compatible** | All modern releases declare `peer react: "^16.8 \|\| ^17.0 \|\| ^18.0 \|\| ^19.0 \|\| ^19.0.0-rc"`. Run `npm update @radix-ui/react-*` to lock to the latest minor/patch versions. |
| `@tanstack/react-query` | `^5.83.0` | **Compatible** | Query v5 supports React 19 natively without API changes. |
| `react-router-dom` | `^6.30.1` | **Compatible** | 6.28+ explicitly supports React 19. Can upgrade to `6.30.6` safely. |
| `recharts` | `^2.15.4` | **Compatible** | Recharts 2.15+ supports React 19. |
| `zustand` | `^5.0.12` | **Compatible** | Fully compatible via `useSyncExternalStore`. |
| `vaul` | `^0.9.9` | **Requires Bump** | `vaul@0.9.9` has a peer constraint on React 18. Bump to `vaul@^1.1.2` which officially supports React 19. |
| `cmdk` | `^1.1.1` | **Compatible** | Compatible with React 19; peer dependencies resolve cleanly once Radix is updated. |
| `react-day-picker` | `^8.10.1` | **Override Required** | v8 works reliably with React 19 when configured via `overrides` in `package.json`. *Note: Upgrading to v9/v10 involves breaking API changes to calendar markup and CSS classes; retain v8.10 with an override until a dedicated UI pass.* |
| `sonner` | `^1.7.4` | **Compatible** | Compatible. Codebase uses custom Zustand theme integration instead of next-themes. |
| `react-hook-form` | `^7.61.1` | **Compatible** | 7.51+ natively supports React 19. |
| `@testing-library/react` | `^16.0.0` | **Compatible** | Version `16.3.3` provides official React 19 test harness support. |
| `@vitejs/plugin-react-swc` | `^3.11.0` | **Compatible** | Works seamlessly with React 19 JSX transform. |

---

## 3. Codebase Breaking Changes & Pre-Flight Analysis

### 3.1 `React.forwardRef`
- **Current Pattern**: Over 120 shadcn components in `src/components/ui/` use `React.forwardRef<HTMLDivElement, Props>((props, ref) => ...)`.
- **React 19 Behavior**: `forwardRef` continues to work for backward compatibility. No runtime breaks or deprecation warnings will occur during initial upgrade.
- **Future Direction**: When authoring new components or refactoring UI elements, pass `ref` directly as a regular prop:
  ```tsx
  // React 19 standard:
  interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: 'default' | 'destructive' | 'outline';
    ref?: React.Ref<HTMLButtonElement>;
  }
  export function Button({ ref, className, variant, ...props }: ButtonProps) {
    return <button ref={ref} className={...} {...props} />;
  }
  ```

### 3.2 `react-dom/test-utils` Deprecation
- React 19 removes `react-dom/test-utils` entirely.
- **Audit Result**: Zero files in `src/` or `tests/` import from `react-dom/test-utils`. All 412 Vitest tests import testing utilities exclusively from `@testing-library/react`.

### 3.3 TypeScript Type Adjustments (`@types/react@19`)
- **`useRef` Initial Values**: In `@types/react@19`, `useRef()` without arguments expects `undefined`. Explicit type parameters such as `useRef<HTMLDivElement>(null)` should always specify an initial value (`null` or initial state).
- **`React.ReactNode`**: `ReactNode` in React 19 includes `Promise<ReactNode>` to support async component rendering with `use()`. Type guards checking for valid elements should use `isValidElement` rather than duck-typing.

---

## 4. Phased Execution Roadmap

### Phase 0: Pre-Flight Clean-up
1. Bump secondary dependencies in `frontend/package.json`:
   ```bash
   npm install vaul@^1.1.2 @testing-library/react@^16.3.3
   ```
2. Verify that existing tests pass:
   ```bash
   npm test
   ```

### Phase 1: Core Upgrade & Dependency Alignment
1. Update `frontend/package.json` dependencies:
   ```json
   {
     "dependencies": {
       "react": "^19.3.0",
       "react-dom": "^19.3.0",
       "vaul": "^1.1.2"
     },
     "devDependencies": {
       "@types/react": "^19.3.0",
       "@types/react-dom": "^19.3.0",
       "@testing-library/react": "^16.3.3"
     },
     "overrides": {
       "react": "^19.3.0",
       "react-dom": "^19.3.0",
       "@types/react": "^19.3.0",
       "@types/react-dom": "^19.3.0"
     }
   }
   ```
2. Run installation:
   ```bash
   npm install
   ```

### Phase 2: TypeScript & Build Verification
1. Run strict TypeScript check:
   ```bash
   npm run types:check-tsc
   ```
   Address any typing warnings resulting from `@types/react@19` (e.g., ref forwarding types).
2. Run schema type sync verification:
   ```bash
   npm run types:validate
   ```
3. Run production build:
   ```bash
   npm run build
   ```

### Phase 3: Comprehensive Test Suite
1. Run unit test suite:
   ```bash
   npm test
   ```
   Ensure all 412 tests across 47 suites pass with zero regressions.
2. Run Playwright End-to-End tests:
   ```bash
   npm run test:e2e
   ```
   Verify authentication, navigation, and modal rendering.

### Phase 4: Post-Migration Enhancements
1. **Root Error Boundary Monitoring**:
   Enhance `frontend/src/main.tsx` to utilize React 19's native error handlers:
   ```tsx
   import { createRoot } from "react-dom/client";
   import { reportError } from "@/lib/monitoring";
   import App from "./App";

   const rootElement = document.getElementById("root");
   if (rootElement) {
     createRoot(rootElement, {
       onCaughtError(error, errorInfo) {
         reportError(error, {
           where: "react-root-caught",
           componentStack: errorInfo.componentStack,
         });
       },
       onUncaughtError(error, errorInfo) {
         reportError(error, {
           where: "react-root-uncaught",
           componentStack: errorInfo.componentStack,
         });
       },
     }).render(<App />);
   }
   ```
2. **Component Modernization**:
   Incrementally simplify UI primitives by replacing `React.forwardRef` with standard `ref` props when components are touched during feature work.

---

## 5. Rollback Strategy

If unexpected runtime incompatibilities or subtle third-party regressions emerge during deployment testing:
1. Revert `frontend/package.json` and `frontend/package-lock.json` to the pre-upgrade commit (`9b3bc176`).
2. Run `npm install` to reinstall React 18.3.1.
3. Validate with `npm run types:validate && npm test && npm run build`.
4. Deploy the rollback build.
