// Thin re-export — keeps the router's lazy(() => import('./pages/Operations')) unchanged
// All logic now lives in ./operations/index.tsx
export { default } from './operations/index';
