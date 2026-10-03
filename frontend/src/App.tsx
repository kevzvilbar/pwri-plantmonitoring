import { lazy, Suspense, useEffect } from "react";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { queryClient } from "@/lib/queryClient";
import {
  queryPersister,
  CACHE_MAX_AGE,
  CACHE_BUSTER,
  shouldDehydrateQuery,
  shouldDehydrateMutation,
} from "@/lib/queryPersister";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/useAuth";
import { PresenceProvider } from "@/hooks/usePresence";
import { AppLoading } from '@/components/AppLoading';
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AppShell } from "@/components/AppShell";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { useThemeStore } from "@/store/themeStore";

const Auth = lazy(() => import("./pages/Auth"));
const Onboarding = lazy(() => import("./pages/Onboarding"));
const PendingApproval = lazy(() => import("./pages/PendingApproval"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Plants = lazy(() => import("./pages/Plants"));
const Hydraulics = lazy(() => import("./pages/Hydraulics"));
const Operations = lazy(() => import("./pages/Operations"));
const ROTrains = lazy(() => import("./pages/ROTrains"));
const Costs = lazy(() => import("./pages/Costs"));
const Maintenance = lazy(() => import("./pages/Maintenance"));
const Incidents = lazy(() => import("./pages/Incidents"));
const Employees = lazy(() => import("./pages/Employees"));
const Import = lazy(() => import("./pages/Import"));
const Compliance = lazy(() => import("./pages/Compliance"));
const Exports = lazy(() => import("./pages/Exports"));
const Admin = lazy(() => import("./pages/Admin"));
const Profile = lazy(() => import("./pages/Profile"));
const Help = lazy(() => import("./pages/Help"));
const MyCorrections = lazy(() => import("./pages/MyCorrections"));
const NotFound = lazy(() => import("./pages/NotFound"));
const PlantTopology = lazy(() => import("./pages/PlantTopology"));
const DataAnalysis  = lazy(() => import("./pages/DataAnalysis"));
const DataCorrections = lazy(() => import("./pages/DataCorrections"));
const ManagerScorecard = lazy(() => import("./pages/ManagerScorecard"));
const Chemicals = lazy(() => import("./pages/Chemicals"));
const Alerts = lazy(() => import("./pages/Alerts"));

const RouteFallback = () => (
  <AppLoading className="h-[60vh] w-full text-sm text-muted-foreground" />
);

/** Applies data-theme and .dark to <html> with fluid view transitions when supported. */
function ThemeEffect() {
  const colorTheme = useThemeStore((s) => s.colorTheme);
  const darkMode = useThemeStore((s) => s.darkMode);

  useEffect(() => {
    const applyTheme = () => {
      const root = document.documentElement;
      if (colorTheme && colorTheme !== 'default') {
        root.setAttribute('data-theme', colorTheme);
      } else {
        root.removeAttribute('data-theme');
      }
      root.classList.toggle('dark', darkMode);
    };

    const doc = document as Document & { startViewTransition?: (cb: () => void) => void };
    if (typeof doc.startViewTransition === 'function') {
      doc.startViewTransition(() => {
        applyTheme();
      });
    } else {
      applyTheme();
    }
  }, [colorTheme, darkMode]);

  return null;
}

const persistOptions = {
  persister: queryPersister,
  maxAge: CACHE_MAX_AGE,
  buster: CACHE_BUSTER,
  dehydrateOptions: {
    shouldDehydrateQuery,
    shouldDehydrateMutation,
  },
};

const App = () => (
  <PersistQueryClientProvider
    client={queryClient}
    persistOptions={persistOptions}
    onSuccess={() => {
      void queryClient.resumePausedMutations();
    }}
  >
    <ThemeEffect />
    <TooltipProvider>
      <Sonner position="top-center" />
      <BrowserRouter
        basename={import.meta.env.BASE_URL}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <AuthProvider>
          <PresenceProvider>
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
                  {/* P5-3: a well's detail page is a child route of its plant */}
                  <Route path="/plants/:id/wells/:wellId" element={<Plants />} />
                  <Route path="/hydraulics" element={<Hydraulics />} />
                  <Route path="/operations" element={<Operations />} />
                  <Route path="/ro-trains" element={<ROTrains />} />
                  {/* ── NEW ── */}
                  <Route path="/topology" element={<PlantTopology />} />
                  <Route path="/data-analysis" element={<DataAnalysis />} />
                  <Route path="/costs" element={<Costs />} />
                  <Route path="/maintenance" element={<Maintenance />} />
                  <Route path="/incidents" element={<Incidents />} />
                  <Route path="/employees" element={<Employees />} />
                  <Route path="/data-corrections" element={<DataCorrections />} />
                  <Route path="/manager-scorecard" element={<ManagerScorecard />} />
                  <Route path="/scorecard" element={<Navigate to="/manager-scorecard" replace />} />
                  <Route path="/import" element={<Import />} />
                  <Route path="/exports" element={<Exports />} />
                  <Route path="/compliance" element={<Compliance />} />
                  <Route path="/alerts" element={<Alerts />} />
                  <Route path="/admin" element={<Admin />} />
                  <Route path="/profile" element={<Profile />} />
                  <Route path="/help" element={<Help />} />
                  <Route path="/my-corrections" element={<MyCorrections />} />
                  {/* Legacy redirect shim — Chemical Dosing moved to RO Trains */}
                  <Route path="/chemicals" element={<Chemicals />} />
                </Route>
                <Route path="*" element={<NotFound />} />
              </Routes>
              </Suspense>
            </ErrorBoundary>
          </PresenceProvider>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </PersistQueryClientProvider>
);

export default App;
