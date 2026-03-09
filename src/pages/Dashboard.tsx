import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BookOpen, Users, ShoppingBag, Trophy } from "lucide-react";
import { useNavigate } from "react-router-dom";

const quickActions = [
  { title: "My Collection", desc: "View your player cards", icon: BookOpen, url: "/collection", color: "text-gem-emerald" },
  { title: "Play With Friends", desc: "Challenge a friend", icon: Users, url: "#", color: "text-gem-diamond" },
  { title: "The Runs", desc: "Race to 21 Gauntlet", icon: Trophy, url: "/runs", color: "text-gem-amethyst" },
  { title: "Pack Market", desc: "Open new packs", icon: ShoppingBag, url: "/packs", color: "text-gem-gold" },
];

export default function Dashboard() {
  const { user, role } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-3xl font-bold tracking-wider">
          Welcome Back
        </h1>
        <p className="text-muted-foreground mt-1">
          {role === "admin" ? "Admin Dashboard" : "Player Dashboard"}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {quickActions.map((action) => (
          <Card
            key={action.title}
            className="cursor-pointer border-border/50 bg-card hover:bg-accent/30 transition-colors group"
            onClick={() => navigate(action.url)}
          >
            <CardHeader className="pb-2">
              <action.icon className={`h-8 w-8 ${action.color} group-hover:scale-110 transition-transform`} />
            </CardHeader>
            <CardContent>
              <CardTitle className="font-display text-lg">{action.title}</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">{action.desc}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="border-border/50 bg-card">
          <CardHeader>
            <CardTitle className="font-display">Recent Games</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-sm">No games played yet. Start a match!</p>
          </CardContent>
        </Card>

        <Card className="border-border/50 bg-card">
          <CardHeader>
            <CardTitle className="font-display">Collection Progress</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-sm">Open packs to start building your collection.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
