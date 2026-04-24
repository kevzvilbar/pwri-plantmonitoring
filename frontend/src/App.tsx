import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/useAuth";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AppShell } from "@/components/AppShell";
import Auth from "./pages/Auth";
import Onboarding from "./pages/Onboarding";
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
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner position="top-center" />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/auth" element={<Auth />} />
            <Route path="/onboarding" element={<Onboarding />} />
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
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
