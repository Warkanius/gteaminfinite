import { ReactNode } from "react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { useAuth } from "@/hooks/useAuth";

export function AppLayout({ children }: { children: ReactNode }) {
  const { user } = useAuth();

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full">
        <AppSidebar />
        <main className="flex-1 flex flex-col">
          <header className="h-14 flex items-center border-b border-border px-4 gap-4 bg-background/40 backdrop-blur-md sticky top-0 z-10">
            <SidebarTrigger />
            <div className="flex-1" />
            <CurrencyDisplay />
          </header>
          <div className="flex-1 p-6 relative">
            {/* Subtle glow orb in the background */}
            <div className="absolute top-1/4 right-1/4 w-[40vw] h-[40vw] bg-primary/5 rounded-full blur-[120px] pointer-events-none -z-10" />
            {children}
          </div>
        </main>
      </div>
    </SidebarProvider>
  );
}

function CurrencyDisplay() {
  return (
    <div className="flex items-center gap-4 text-sm">
      <div className="flex items-center gap-1.5">
        <span className="text-primary font-display font-bold">🪙</span>
        <span className="text-muted-foreground">0</span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-gem-diamond font-display font-bold">💎</span>
        <span className="text-muted-foreground">0</span>
      </div>
    </div>
  );
}
