import { ReactNode, useEffect } from "react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { useAuth } from "@/hooks/useAuth";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { Bell, BellRing } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatDistanceToNow } from "date-fns";
import { usePushNotifications } from "@/hooks/usePushNotifications";

export function AppLayout({ children }: { children: ReactNode }) {
  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full">
        <AppSidebar />
        <main className="flex-1 flex flex-col">
          <header className="flex items-center border-b border-border px-4 gap-4 bg-background/40 backdrop-blur-md sticky top-0 z-10 h-[calc(3.5rem+env(safe-area-inset-top))] pt-[env(safe-area-inset-top)]">
            <SidebarTrigger />
            <div className="flex-1" />
            <NotificationBell />
            <CurrencyDisplay />
          </header>
          <div className="flex-1 p-6 relative">
            <div className="absolute top-1/4 right-1/4 w-[40vw] h-[40vw] bg-primary/5 rounded-full blur-[120px] pointer-events-none -z-10" />
            {children}
          </div>
        </main>
      </div>
    </SidebarProvider>
  );
}

function NotificationBell() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { supported, subscribed, loading: pushLoading, subscribe, unsubscribe } = usePushNotifications();

  const { data: notifications = [] } = useQuery({
    queryKey: ["notifications", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("notifications")
        .select("*")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(20);
      return data ?? [];
    },
    enabled: !!user,
    refetchInterval: 30000,
  });

  // Realtime subscription
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel("notifications-realtime")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` }, () => {
        qc.invalidateQueries({ queryKey: ["notifications", user.id] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user, qc]);

  const unreadCount = notifications.filter((n: any) => !n.read).length;

  const markRead = useMutation({
    mutationFn: async (id: string) => {
      await supabase.from("notifications").update({ read: true }).eq("id", id);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications", user?.id] }),
  });

  if (!user) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative h-8 w-8">
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 h-4 min-w-4 px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <h4 className="font-semibold text-sm">Notifications</h4>
          {supported && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs gap-1"
              disabled={pushLoading}
              onClick={subscribed ? unsubscribe : subscribe}
            >
              <BellRing className="h-3 w-3" />
              {subscribed ? "Push On" : "Enable Push"}
            </Button>
          )}
        </div>
        <ScrollArea className="max-h-72">
          {notifications.length === 0 ? (
            <div className="p-4 text-center text-sm text-muted-foreground">No notifications yet</div>
          ) : (
            notifications.map((n: any) => (
              <button
                key={n.id}
                className={`w-full text-left px-4 py-3 border-b border-border/50 hover:bg-muted/50 transition-colors ${!n.read ? "bg-primary/5" : ""}`}
                onClick={() => {
                  if (!n.read) markRead.mutate(n.id);
                  if (n.link) navigate(n.link);
                }}
              >
                <p className="text-sm font-medium">{n.title}</p>
                <p className="text-xs text-muted-foreground line-clamp-2">{n.body}</p>
                <p className="text-[10px] text-muted-foreground mt-1">
                  {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                </p>
              </button>
            ))
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}

function CurrencyDisplay() {
  const { user } = useAuth();

  const { data: profile } = useQuery({
    queryKey: ["profile-currency", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("coins, gems")
        .eq("user_id", user!.id)
        .single();
      return data;
    },
    enabled: !!user,
    refetchInterval: 15000,
  });

  return (
    <div className="flex items-center gap-4 text-sm">
      <div className="flex items-center gap-1.5">
        <span className="text-primary font-display font-bold">🪙</span>
        <span className="font-mono font-medium">{(profile?.coins ?? 0).toLocaleString()}</span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-gem-diamond font-display font-bold">💎</span>
        <span className="font-mono font-medium">{(profile?.gems ?? 0).toLocaleString()}</span>
      </div>
    </div>
  );
}
