import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { computeOVR } from "@/lib/ovrUtils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BookOpen, Users, ShoppingBag, Trophy, Gift, Sparkles } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { PackReveal } from "@/components/packs/PackReveal";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useQuery } from "@tanstack/react-query";
import { PostCard, POST_SELECT, type FeedPost } from "@/components/social/PostCard";
import { Link } from "react-router-dom";

const quickActions = [
  { title: "My Collection", desc: "View your player cards", icon: BookOpen, url: "/collection", color: "text-gem-emerald" },
  { title: "Play With Friends", desc: "Coming soon!", icon: Users, url: "/play", color: "text-gem-diamond" },
  { title: "The Runs", desc: "Race to 21 Gauntlet", icon: Trophy, url: "/runs", color: "text-gem-amethyst" },
  { title: "Pack Market", desc: "Open new packs", icon: ShoppingBag, url: "/packs", color: "text-gem-gold" },
];

interface StarterPack {
  id: string;
  name: string;
  players: { id: string; name: string; rating: number; position1: string | null }[];
}

export default function Dashboard() {
  const { user, role } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [showStarterPicker, setShowStarterPicker] = useState(false);
  const [starterPacks, setStarterPacks] = useState<StarterPack[]>([]);
  const [claiming, setClaiming] = useState(false);
  const [revealCards, setRevealCards] = useState<any[] | null>(null);
  const [checkedStarter, setCheckedStarter] = useState(false);
  const [needsFirstCards, setNeedsFirstCards] = useState(false);

  useEffect(() => {
    if (user) checkStarterPack();
  }, [user]);

  async function checkStarterPack() {
    // Get all starter packs
    const { data: starters } = await supabase
      .from("packs")
      .select("id")
      .eq("pack_type", "starter");

    // No starter packs configured — make sure brand-new players still get a path forward
    if (!starters || starters.length === 0) {
      await checkEmptyCollection();
      setCheckedStarter(true);
      return;
    }

    // Check if user already claimed one
    const starterIds = starters.map((s) => s.id);
    const { count } = await supabase
      .from("pack_purchases")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user!.id)
      .in("pack_id", starterIds);

    if (count && count > 0) {
      setCheckedStarter(true);
      return;
    }

    // Fetch starter packs with their players
    const { data: packsWithPlayers } = await supabase
      .from("packs")
      .select("id, name")
      .eq("pack_type", "starter");

    const packs: StarterPack[] = [];
    for (const pack of packsWithPlayers || []) {
      const { data: packPlayers } = await supabase
        .from("pack_players")
        .select("player_card_id")
        .eq("pack_id", pack.id);

      if (packPlayers && packPlayers.length > 0) {
        const cardIds = packPlayers.map((pp) => pp.player_card_id);
        const { data: cards } = await supabase
          .from("player_cards")
          .select("id, name, rating, position1, stat_3pt, stat_mid, stat_fin, stat_dnk, stat_stl, stat_blk, stat_ast, stat_reb, stat_int")
          .in("id", cardIds);

        packs.push({ id: pack.id, name: pack.name, players: cards || [] });
      }
    }

    if (packs.length > 0) {
      setStarterPacks(packs);
      setShowStarterPicker(true);
    } else {
      await checkEmptyCollection();
    }
    setCheckedStarter(true);
  }

  async function checkEmptyCollection() {
    const { count } = await supabase
      .from("user_collections")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user!.id);
    setNeedsFirstCards(!count);
  }

  async function claimPack(packId: string) {
    setClaiming(true);
    try {
      const { data, error } = await supabase.functions.invoke("claim-starter-pack", {
        body: { pack_id: packId },
      });

      if (error) {
        console.error("[claimPack] invoke error", error);
        toast({
          title: "Claim Failed",
          description: error.message || "Network error — please try again.",
          variant: "destructive",
        });
        setClaiming(false);
        return;
      }

      if (!data) {
        console.error("[claimPack] no data returned from edge function");
        toast({
          title: "Claim Failed",
          description: "No response from server. Please try again.",
          variant: "destructive",
        });
        setClaiming(false);
        return;
      }

      if (data.error) {
        console.error("[claimPack] server returned error", data);
        toast({
          title: "Claim Failed",
          description: data.error + (data.detail ? ` (${data.detail})` : ""),
          variant: "destructive",
        });
        setClaiming(false);
        return;
      }

      const cards = Array.isArray(data.cards) ? data.cards : [];
      if (cards.length === 0) {
        console.error("[claimPack] success response had no cards", data);
        toast({
          title: "Something went wrong",
          description: "No cards were returned. Please try again.",
          variant: "destructive",
        });
        setClaiming(false);
        return;
      }

      setShowStarterPicker(false);
      setRevealCards(cards);
    } catch (err: any) {
      console.error("[claimPack] exception", err);
      toast({
        title: "Error",
        description: err?.message || "Something went wrong",
        variant: "destructive",
      });
    }
    setClaiming(false);
  }

  if (revealCards) {
    return (
      <PackReveal
        cards={revealCards}
        onOpenAnother={() => setRevealCards(null)}
        onClose={() => setRevealCards(null)}
      />
    );
  }

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

      {needsFirstCards && (
        <Card className="border-amber-500/40 bg-amber-500/10">
          <CardHeader>
            <CardTitle className="text-base">Get your first cards</CardTitle>
            <CardDescription>
              No starter pack is available right now. Head to the Pack Store to grab your first
              players, or redeem a locker code if you have one.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => navigate("/packs")}>Open Pack Store</Button>
            <Button size="sm" variant="outline" onClick={() => navigate("/locker-codes")}>
              Redeem a code
            </Button>
          </CardContent>
        </Card>
      )}

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

      <LeagueFeedCard />


      {/* Starter Pack Selection Dialog */}
      <Dialog
        open={showStarterPicker}
        onOpenChange={(open) => {
          if (!claiming) setShowStarterPicker(open);
        }}
      >
        <DialogContent
          className="sm:max-w-2xl"
          onPointerDownOutside={(e) => {
            if (claiming) e.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle className="font-display text-2xl flex items-center gap-2">
              <Sparkles className="h-6 w-6 text-gem-gold" />
              Choose Your Starter Pack
            </DialogTitle>
            <DialogDescription>
              Pick one starter pack to begin your journey. This is a one-time choice!
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
            {starterPacks.map((pack) => (
              <Card
                key={pack.id}
                className="border-border/50 bg-secondary/30 hover:bg-secondary/50 transition-colors"
              >
                <CardHeader className="pb-2">
                  <CardTitle className="font-display text-lg flex items-center gap-2">
                    <Gift className="h-5 w-5 text-gem-gold" />
                    {pack.name}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="space-y-1">
                    {pack.players.map((p) => (
                      <div key={p.id} className="flex items-center justify-between text-sm">
                        <span>{p.name}</span>
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <span>{computeOVR(p)} OVR</span>
                          {p.position1 && <Badge variant="outline" className="text-xs">{p.position1}</Badge>}
                        </div>
                      </div>
                    ))}
                  </div>
                  <Button
                    className="w-full"
                    disabled={claiming}
                    onClick={() => claimPack(pack.id)}
                  >
                    {claiming ? "Claiming..." : "Choose This Pack"}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
          <div className="flex justify-end mt-4">
            <Button
              variant="ghost"
              size="sm"
              disabled={claiming}
              onClick={() => setShowStarterPicker(false)}
            >
              Skip for now
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function LeagueFeedCard() {
  const { data: posts = [], isLoading } = useQuery({
    queryKey: ["dashboard-league-feed"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("social_posts")
        .select(POST_SELECT)
        .eq("is_published", true)
        .order("posted_at", { ascending: false })
        .limit(4);
      if (error) throw error;
      return data as unknown as FeedPost[];
    },
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-xl font-bold tracking-wide">League Feed</h2>
        <Link to="/feed" className="text-sm text-primary hover:underline">View all →</Link>
      </div>
      {isLoading ? (
        <Card className="border-border/50 bg-card">
          <CardContent className="py-8 text-center text-muted-foreground text-sm">Loading…</CardContent>
        </Card>
      ) : posts.length === 0 ? (
        <Card className="border-border/50 bg-card">
          <CardContent className="py-8 text-center text-muted-foreground text-sm">Play a game to make headlines.</CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {posts.map((p) => <PostCard key={p.id} post={p} />)}
        </div>
      )}
    </div>
  );
}
