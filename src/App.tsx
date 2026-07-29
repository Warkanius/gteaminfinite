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
const GemMarket = lazy(() => import("@/pages/GemMarket"));
const Play = lazy(() => import("@/pages/Play"));
const GameHub = lazy(() => import("@/pages/GameHub"));
const Domination = lazy(() => import("@/pages/Domination"));
const RunsHub = lazy(() => import("@/pages/RunsHub"));
const RunPlay = lazy(() => import("@/pages/RunPlay"));
import NotFound from "./pages/NotFound";
const OAuthConsent = lazy(() => import("@/pages/OAuthConsent"));
const Collection = lazy(() => import("@/pages/Collection"));
const PackMarket = lazy(() => import("@/pages/PackMarket"));

const AdminPlayers = lazy(() => import("@/pages/admin/AdminPlayers"));
const AdminPacks = lazy(() => import("@/pages/admin/AdminPacks"));
const AdminTeams = lazy(() => import("@/pages/admin/AdminTeams"));
const AdminBadgesTraits = lazy(() => import("@/pages/admin/AdminBadgesTraits"));
const AdminChallenges = lazy(() => import("@/pages/admin/AdminChallenges"));
const AdminCurrencies = lazy(() => import("@/pages/admin/AdminCurrencies"));
const AdminRules = lazy(() => import("@/pages/admin/AdminRules"));
const AdminLockerCodes = lazy(() => import("@/pages/admin/AdminLockerCodes"));
const LockerCodes = lazy(() => import("@/pages/LockerCodes"));
const AuctionHouse = lazy(() => import("@/pages/AuctionHouse"));
const GemTasks = lazy(() => import("@/pages/GemTasks"));
const AdminGemTasks = lazy(() => import("@/pages/admin/AdminGemTasks"));
const AdminAuction = lazy(() => import("@/pages/admin/AdminAuction"));
const AdminGemMarket = lazy(() => import("@/pages/admin/AdminGemMarket"));
const AdminStarterPacks = lazy(() => import("@/pages/admin/AdminStarterPacks"));
const AdminSocialFeed = lazy(() => import("@/pages/admin/AdminSocialFeed"));
const SocialFeed = lazy(() => import("@/pages/SocialFeed"));
const FeedProfile = lazy(() => import("@/pages/FeedProfile"));
const Install = lazy(() => import("@/pages/Install"));
const AdminCollections = lazy(() => import("@/pages/admin/AdminCollections"));
const AdminCollectionSets = lazy(() => import("@/pages/admin/AdminCollectionSets"));
const Challenges = lazy(() => import("@/pages/Challenges"));
const Settings = lazy(() => import("@/pages/Settings"));
const AdminDynamicDuos = lazy(() => import("@/pages/admin/AdminDynamicDuos"));
const AdminStorylines = lazy(() => import("@/pages/admin/AdminStorylines"));
const LeagueHistory = lazy(() => import("@/pages/LeagueHistory"));
const AdminGlobalExport = lazy(() => import("@/pages/admin/AdminGlobalExport"));

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

function AdminRoute({ children }: { children: React.ReactNode }) {
  const { user, role, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!user) return <Navigate to="/auth" replace />;
  if (role !== "admin") return <Navigate to="/" replace />;

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
            <Route path="/.lovable/oauth/consent" element={<LazyLoad><OAuthConsent /></LazyLoad>} />
            <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
            <Route path="/collection" element={<ProtectedRoute><LazyLoad><Collection /></LazyLoad></ProtectedRoute>} />
            <Route path="/play" element={<ProtectedRoute><LazyLoad><GameHub /></LazyLoad></ProtectedRoute>} />
            <Route path="/play/match" element={<ProtectedRoute><LazyLoad><Play /></LazyLoad></ProtectedRoute>} />
            <Route path="/domination" element={<ProtectedRoute><LazyLoad><Domination /></LazyLoad></ProtectedRoute>} />
            <Route path="/runs" element={<ProtectedRoute><LazyLoad><RunsHub /></LazyLoad></ProtectedRoute>} />
            <Route path="/runs/:runId" element={<ProtectedRoute><LazyLoad><RunPlay /></LazyLoad></ProtectedRoute>} />
            <Route path="/packs" element={<ProtectedRoute><LazyLoad><PackMarket /></LazyLoad></ProtectedRoute>} />
            <Route path="/gems" element={<ProtectedRoute><LazyLoad><GemMarket /></LazyLoad></ProtectedRoute>} />
            <Route path="/admin/players" element={<AdminRoute><LazyLoad><AdminPlayers /></LazyLoad></AdminRoute>} />
            <Route path="/admin/packs" element={<AdminRoute><LazyLoad><AdminPacks /></LazyLoad></AdminRoute>} />
            <Route path="/admin/teams" element={<AdminRoute><LazyLoad><AdminTeams /></LazyLoad></AdminRoute>} />
            <Route path="/admin/badges" element={<AdminRoute><LazyLoad><AdminBadgesTraits /></LazyLoad></AdminRoute>} />
            <Route path="/admin/challenges" element={<AdminRoute><LazyLoad><AdminChallenges /></LazyLoad></AdminRoute>} />
            <Route path="/admin/currencies" element={<AdminRoute><LazyLoad><AdminCurrencies /></LazyLoad></AdminRoute>} />
            <Route path="/admin/rules" element={<AdminRoute><LazyLoad><AdminRules /></LazyLoad></AdminRoute>} />
            <Route path="/admin/locker-codes" element={<AdminRoute><LazyLoad><AdminLockerCodes /></LazyLoad></AdminRoute>} />
            <Route path="/locker-codes" element={<ProtectedRoute><LazyLoad><LockerCodes /></LazyLoad></ProtectedRoute>} />
            <Route path="/auction" element={<ProtectedRoute><LazyLoad><AuctionHouse /></LazyLoad></ProtectedRoute>} />
            <Route path="/gem-tasks" element={<ProtectedRoute><LazyLoad><GemTasks /></LazyLoad></ProtectedRoute>} />
            <Route path="/admin/gem-tasks" element={<AdminRoute><LazyLoad><AdminGemTasks /></LazyLoad></AdminRoute>} />
            <Route path="/admin/auction" element={<AdminRoute><LazyLoad><AdminAuction /></LazyLoad></AdminRoute>} />
            <Route path="/admin/gem-market" element={<AdminRoute><LazyLoad><AdminGemMarket /></LazyLoad></AdminRoute>} />
            <Route path="/admin/starter-packs" element={<AdminRoute><LazyLoad><AdminStarterPacks /></LazyLoad></AdminRoute>} />
            <Route path="/admin/social-feed" element={<AdminRoute><LazyLoad><AdminSocialFeed /></LazyLoad></AdminRoute>} />
            <Route path="/feed" element={<ProtectedRoute><LazyLoad><SocialFeed /></LazyLoad></ProtectedRoute>} />
            <Route path="/feed/profile/:handle" element={<ProtectedRoute><LazyLoad><FeedProfile /></LazyLoad></ProtectedRoute>} />
            <Route path="/install" element={<ProtectedRoute><LazyLoad><Install /></LazyLoad></ProtectedRoute>} />
            <Route path="/admin/collections" element={<AdminRoute><LazyLoad><AdminCollections /></LazyLoad></AdminRoute>} />
            <Route path="/admin/collection-sets" element={<AdminRoute><LazyLoad><AdminCollectionSets /></LazyLoad></AdminRoute>} />
            <Route path="/challenges" element={<ProtectedRoute><LazyLoad><Challenges /></LazyLoad></ProtectedRoute>} />
            <Route path="/settings" element={<ProtectedRoute><LazyLoad><Settings /></LazyLoad></ProtectedRoute>} />
            <Route path="/admin/dynamic-duos" element={<AdminRoute><LazyLoad><AdminDynamicDuos /></LazyLoad></AdminRoute>} />
            <Route path="/admin/storylines" element={<AdminRoute><LazyLoad><AdminStorylines /></LazyLoad></AdminRoute>} />
            <Route path="/league" element={<ProtectedRoute><LazyLoad><LeagueHistory /></LazyLoad></ProtectedRoute>} />
            <Route path="/admin/global-export" element={<AdminRoute><LazyLoad><AdminGlobalExport /></LazyLoad></AdminRoute>} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
