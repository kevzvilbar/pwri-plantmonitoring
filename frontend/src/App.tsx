import { lazy, Suspense, useEffect } from "react";
import { QueryClient, QueryClientProvider, QueryCache, MutationCache } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner, toast } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/useAuth";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AppShell } from "@/components/AppShell";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { useAppStore } from "@/store/appStore";

const Auth = lazy(() => import("./pages/Auth"));
const Onboarding = lazy(() => import("./pages/Onboarding"));
const PendingApproval = lazy(() => import("./pages/PendingApproval"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Plants = lazy(() => import("./pages/Plants"));
const Operations = lazy(() => import("./pages/Operations"));
const ROTrains = lazy(() => import("./pages/ROTrains"));
const Costs = lazy(() => import("./pages/Costs"));
const Maintenance = lazy(() => import("./pages/Maintenance"));
const Incidents = lazy(() => import("./pages/Incidents"));
const Employees = lazy(() => import("./pages/Employees"));
const Import = lazy(() => import("./pages/Import"));
const AIAssistant = lazy(() => import("./pages/AIAssistant"));
const Compliance = lazy(() => import("./pages/Compliance"));
const Exports = lazy(() => import("./pages/Exports"));
const Admin = lazy(() => import("./pages/Admin"));
const Profile = lazy(() => import("./pages/Profile"));
const NotFound = lazy(() => import("./pages/NotFound"));
// ── NEW ──────────────────────────────────────────────────────────────────────
const PlantTopology = lazy(() => import("./pages/PlantTopology"));
const DataAnalysis  = lazy(() => import("./pages/DataAnalysis"));

const RouteFallback = () => (
  <div className="flex h-[60vh] w-full items-center justify-center text-sm text-muted-foreground">
    Loading…
  </div>
);

/** Applies data-theme to <html> whenever the persisted preference changes. */
function ThemeEffect() {
  const colorTheme = useAppStore((s) => s.colorTheme);
  useEffect(() => {
    const root = document.documentElement;
    if (colorTheme && colorTheme !== 'default') {
      root.setAttribute('data-theme', colorTheme);
    } else {
      root.removeAttribute('data-theme');
    }
  }, [colorTheme]);
  return null;
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,   // handled by useBackgroundSync visibilitychange listener
      refetchOnReconnect: true,      // re-sync immediately when network comes back
      // 30 s staleTime: data is considered fresh for 30 s, so back-to-back renders
      // of the same query key do NOT double-fire.  The centralised 60-second tick
      // in useBackgroundSync is the primary freshness driver.
      staleTime: 30_000,
      // gcTime (formerly cacheTime): keep evicted queries around for 5 min so
      // navigating back to a page shows cached data instantly while re-fetching.
      gcTime: 5 * 60_000,
    },
    mutations: {
      retry: 0,
    },
  },
  queryCache: new QueryCache({
    onError: (error, query) => {
      const msg = error instanceof Error ? error.message : String(error);
      if (!msg || /abort/i.test(msg)) return;
      // Queries with meta.silent = true silently fail (backend unavailable in static deploy)
      if (query.meta?.silent) return;
      const key = Array.isArray(query.queryKey) ? String(query.queryKey[0]) : 'query';
      toast.error(`Load failed (${key}): ${msg}`);
    },
  }),
  mutationCache: new MutationCache({
    onError: (error) => {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg) toast.error(msg);
    },
  }),
});

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeEffect />
    <TooltipProvider>
      <Toaster />
      <Sonner position="top-center" />
      <BrowserRouter basename="/pwri-plantmonitoring">
        <AuthProvider>
          <ErrorBoundary>
            <Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route path="/auth" element={<Auth />} />
              <Route path="/onboarding" element={<Onboarding />} />
              <Route
                path="/pending-approval"
                element={
                  <ProtectedRoute>
                    <PendingApproval />
                  </ProtectedRoute>
                }
              />
              <Route element={<ProtectedRoute><AppShell /></ProtectedRoute>}>
                <Route path="/" element={<Dashboard />} />
                <Route path="/plants" element={<Plants />} />
                <Route path="/plants/:id" element={<Plants />} />
                <Route path="/operations" element={<Operations />} />
                <Route path="/ro-trains" element={<ROTrains />} />
                {/* ── NEW ── */}
                <Route path="/topology" element={<PlantTopology />} />
                <Route path="/data-analysis" element={<DataAnalysis />} />
                <Route path="/costs" element={<Costs />} />
                <Route path="/maintenance" element={<Maintenance />} />
                <Route path="/incidents" element={<Incidents />} />
                <Route path="/employees" element={<Employees />} />
                <Route path="/import" element={<Import />} />
                <Route path="/exports" element={<Exports />} />
                <Route path="/ai" element={<AIAssistant />} />
                <Route path="/compliance" element={<Compliance />} />
                <Route path="/admin" element={<Admin />} />
                <Route path="/profile" element={<Profile />} />
              </Route>
              <Route path="*" element={<NotFound />} />
            </Routes>
            </Suspense>
          </ErrorBoundary>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
