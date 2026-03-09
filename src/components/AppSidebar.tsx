import {
  LayoutDashboard,
  Users,
  Package,
  Trophy,
  Swords,
  Sparkles,
  ShoppingBag,
  Settings,
  Shield,
  BookOpen,
  Award,
  Coins,
  LogOut,
} from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useAuth } from "@/hooks/useAuth";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";

const playerItems = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "Collection", url: "/collection", icon: BookOpen },
  { title: "Game Modes", url: "/play", icon: Sparkles },
  { title: "Domination", url: "/domination", icon: Swords },
  { title: "Pack Market", url: "/packs", icon: ShoppingBag },
  { title: "Gem Market", url: "/gems", icon: Award },
];

const adminItems = [
  { title: "Players", url: "/admin/players", icon: Users },
  { title: "Packs & Odds", url: "/admin/packs", icon: Package },
  { title: "Teams & Runs", url: "/admin/teams", icon: Swords },
  { title: "Badges & Traits", url: "/admin/badges", icon: Shield },
  { title: "Challenges", url: "/admin/challenges", icon: Trophy },
  { title: "Currencies", url: "/admin/currencies", icon: Coins },
  { title: "Rules Config", url: "/admin/rules", icon: Settings },
];

export function AppSidebar() {
  const { role, signOut, user } = useAuth();

  return (
    <Sidebar>
      <SidebarHeader className="border-b border-sidebar-border p-4">
        <h2 className="font-display text-xl font-bold tracking-wider text-primary">
          GTeam Infinite
        </h2>
        <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="font-display tracking-wider text-xs">
            Player
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {playerItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to={item.url}
                      end={item.url === "/"}
                      className="hover:bg-accent/50"
                      activeClassName="bg-accent text-primary font-medium"
                    >
                      <item.icon className="mr-2 h-4 w-4" />
                      <span>{item.title}</span>
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {role === "admin" && (
          <SidebarGroup>
            <SidebarGroupLabel className="font-display tracking-wider text-xs">
              Admin
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {adminItems.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild>
                      <NavLink
                        to={item.url}
                        className="hover:bg-accent/50"
                        activeClassName="bg-accent text-primary font-medium"
                      >
                        <item.icon className="mr-2 h-4 w-4" />
                        <span>{item.title}</span>
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border p-2">
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start text-muted-foreground hover:text-destructive"
          onClick={signOut}
        >
          <LogOut className="mr-2 h-4 w-4" />
          Sign Out
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}
