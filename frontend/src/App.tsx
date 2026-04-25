import { QueryClient, QueryClientProvider, QueryCache, MutationCache } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner, toast } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/useAuth";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AppShell } from "@/components/AppShell";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import Auth from "./pages/Auth";
import Onboarding from "./pages/Onboarding";
import PendingApproval from "./pages/PendingApproval";
import Dashboard from "./pages/Dashboard";
import Plants from "./pages/Plants";
import Operations from "./pages/Operations";
import ROTrains from "./pages/ROTrains";
import Chemicals from "./pages/Chemicals";
import Costs from "./pages/Costs";
import Maintenance from "./pages/Maintenance";
import Incidents from "./pages/Incidents";
import Employees from "./pages/Employees";
import Import from "./pages/Import";
import AIAssistant from "./pages/AIAssistant";
import Compliance from "./pages/Compliance";
import Exports from "./pages/Exports";
import Admin from "./pages/Admin";
import Profile from "./pages/Profile";
import NotFound from "./pages/NotFound";

// Global QueryClient with sensible defaults + toast on query/mutation errors.
// Prevents white-screen cascades when Supabase is unreachable.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 15_000,
    },
    mutations: {
      retry: 0,
    },
  },
  queryCache: new QueryCache({
    onError: (error, query) => {
      // Only surface explicit fetch errors, not auth-404s etc.
      const msg = error instanceof Error ? error.message : String(error);
      if (!msg || /abort/i.test(msg)) return;
      // Use the query key tail as context
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
    <TooltipProvider>
      <Toaster />
      <Sonner position="top-center" />
      <BrowserRouter>
        <AuthProvider>
          <ErrorBoundary>
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
                <Route path="/chemicals" element={<Chemicals />} />
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
          </ErrorBoundary>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
