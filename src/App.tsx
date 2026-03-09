import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { AppLayout } from "@/components/AppLayout";
import Auth from "@/pages/Auth";
import Dashboard from "@/pages/Dashboard";
import Placeholder from "@/pages/Placeholder";
const Play = lazy(() => import("@/pages/Play"));
const Domination = lazy(() => import("@/pages/Domination"));
const RunsHub = lazy(() => import("@/pages/RunsHub"));
const RunPlay = lazy(() => import("@/pages/RunPlay"));
import NotFound from "./pages/NotFound";
const Collection = lazy(() => import("@/pages/Collection"));
const PackMarket = lazy(() => import("@/pages/PackMarket"));

const AdminPlayers = lazy(() => import("@/pages/admin/AdminPlayers"));
const AdminPacks = lazy(() => import("@/pages/admin/AdminPacks"));
const AdminTeams = lazy(() => import("@/pages/admin/AdminTeams"));
const AdminBadgesTraits = lazy(() => import("@/pages/admin/AdminBadgesTraits"));
const AdminChallenges = lazy(() => import("@/pages/admin/AdminChallenges"));
const AdminCurrencies = lazy(() => import("@/pages/admin/AdminCurrencies"));
const AdminRules = lazy(() => import("@/pages/admin/AdminRules"));

const LazyLoad = ({ children }: { children: React.ReactNode }) => (
  <Suspense fallback={<div className="flex min-h-[50vh] items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>}>
    {children}
  </Suspense>
);

const queryClient = new QueryClient();

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!user) return <Navigate to="/auth" replace />;

  return <AppLayout>{children}</AppLayout>;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/auth" element={<Auth />} />
            <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
            <Route path="/collection" element={<ProtectedRoute><LazyLoad><Collection /></LazyLoad></ProtectedRoute>} />
            <Route path="/play" element={<ProtectedRoute><LazyLoad><Play /></LazyLoad></ProtectedRoute>} />
            <Route path="/domination" element={<ProtectedRoute><LazyLoad><Domination /></LazyLoad></ProtectedRoute>} />
            <Route path="/packs" element={<ProtectedRoute><LazyLoad><PackMarket /></LazyLoad></ProtectedRoute>} />
            <Route path="/rings" element={<ProtectedRoute><Placeholder /></ProtectedRoute>} />
            <Route path="/admin/players" element={<ProtectedRoute><LazyLoad><AdminPlayers /></LazyLoad></ProtectedRoute>} />
            <Route path="/admin/packs" element={<ProtectedRoute><LazyLoad><AdminPacks /></LazyLoad></ProtectedRoute>} />
            <Route path="/admin/teams" element={<ProtectedRoute><LazyLoad><AdminTeams /></LazyLoad></ProtectedRoute>} />
            <Route path="/admin/badges" element={<ProtectedRoute><LazyLoad><AdminBadgesTraits /></LazyLoad></ProtectedRoute>} />
            <Route path="/admin/challenges" element={<ProtectedRoute><LazyLoad><AdminChallenges /></LazyLoad></ProtectedRoute>} />
            <Route path="/admin/currencies" element={<ProtectedRoute><LazyLoad><AdminCurrencies /></LazyLoad></ProtectedRoute>} />
            <Route path="/admin/rules" element={<ProtectedRoute><LazyLoad><AdminRules /></LazyLoad></ProtectedRoute>} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
