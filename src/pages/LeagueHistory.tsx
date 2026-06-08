import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Newspaper, Trophy, Sparkles, Star, ArrowRight, Flame } from "lucide-react";
import { Link } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";

interface SocialPost {
  id: string;
  content: string;
  post_type: string;
  event_type: string | null;
  posted_at: string;
  image_url: string | null;
  headline_image_url: string | null;
  is_headline: boolean;
  headline_rank: number | null;
  location_account_id: string | null;
  player_card_id: string | null;
  location_accounts?: { name: string; handle: string; accent_color: string | null } | null;
  player_cards?: { name: string; social_handle: string | null } | null;
}

function timeAgo(iso: string) {
  try { return formatDistanceToNow(new Date(iso), { addSuffix: true }); } catch { return ""; }
}

export default function LeagueHistory() {
  const { data: headlines = [], isLoading: loadingHeadlines } = useQuery({
    queryKey: ["league-headlines"],
    queryFn: async () => {
      const { data } = await supabase
        .from("social_posts")
        .select("*, location_accounts(name,handle,accent_color), player_cards(name,social_handle)")
        .eq("is_headline", true)
        .eq("is_published", true)
        .order("headline_rank", { ascending: true })
        .order("posted_at", { ascending: false })
        .limit(4);
      return (data ?? []) as SocialPost[];
    },
  });

  const { data: trending = [] } = useQuery({
    queryKey: ["league-trending"],
    queryFn: async () => {
      const { data } = await supabase
        .from("social_posts")
        .select("*, location_accounts(name,handle,accent_color), player_cards(name,social_handle)")
        .eq("is_published", true)
        .eq("is_headline", false)
        .order("posted_at", { ascending: false })
        .limit(12);
      return (data ?? []) as SocialPost[];
    },
  });

  const { data: storylines = [] } = useQuery({
    queryKey: ["league-storylines"],
    queryFn: async () => {
      const { data } = await supabase
        .from("storylines")
        .select("*")
        .in("status", ["active", "draft"])
        .order("created_at", { ascending: false })
        .limit(6);
      return data ?? [];
    },
  });

  const { data: signings = [] } = useQuery({
    queryKey: ["league-signings"],
    queryFn: async () => {
      const { data } = await supabase
        .from("social_posts")
        .select("*, player_cards(name,social_handle,avatar_url)")
        .eq("event_type", "signing")
        .eq("is_published", true)
        .order("posted_at", { ascending: false })
        .limit(6);
      return (data ?? []) as SocialPost[];
    },
  });

  const { data: results = [] } = useQuery({
    queryKey: ["league-results"],
    queryFn: async () => {
      const { data } = await supabase
        .from("social_posts")
        .select("*, location_accounts(name,handle)")
        .eq("event_type", "game_result")
        .eq("is_published", true)
        .order("posted_at", { ascending: false })
        .limit(6);
      return (data ?? []) as SocialPost[];
    },
  });

  const hero = headlines.find((h) => h.headline_rank === 1) ?? headlines[0];
  const secondary = headlines.filter((h) => h.id !== hero?.id).slice(0, 3);

  return (
    <div className="min-h-screen bg-background">
      {/* Masthead */}
      <header className="border-b border-border bg-gradient-to-b from-primary/10 to-transparent">
        <div className="max-w-6xl mx-auto px-4 py-6">
          <div className="flex items-center gap-2 text-primary">
            <Newspaper className="w-6 h-6" />
            <span className="text-xs uppercase tracking-[0.3em] text-muted-foreground">Official</span>
          </div>
          <h1 className="font-display text-4xl md:text-5xl tracking-wider mt-1 drop-shadow-[0_0_12px_rgba(150,80,255,0.6)]">
            League History
          </h1>
          <p className="text-sm text-muted-foreground">Headlines, storylines, and recaps from across GTeam Infinite.</p>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6 space-y-10">
        {/* Hero + Secondary */}
        <section>
          {loadingHeadlines && <Skeleton className="h-80 w-full" />}
          {!loadingHeadlines && !hero && (
            <Card className="p-8 text-center">
              <p className="text-muted-foreground">No headlines yet. Promote social posts to feature them here.</p>
            </Card>
          )}
          {hero && (
            <div className="grid lg:grid-cols-3 gap-4">
              <article className="lg:col-span-2 relative overflow-hidden rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/10 via-background to-background min-h-[280px] p-6 flex flex-col justify-end">
                {(hero.headline_image_url || hero.image_url) && (
                  <img
                    src={hero.headline_image_url ?? hero.image_url ?? ""}
                    alt=""
                    className="absolute inset-0 w-full h-full object-cover opacity-30"
                  />
                )}
                <div className="relative">
                  <Badge className="bg-primary/90 text-primary-foreground mb-3">
                    <Flame className="w-3 h-3 mr-1" /> Top Story
                  </Badge>
                  <h2 className="font-display text-2xl md:text-4xl leading-tight tracking-wide">{hero.content}</h2>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mt-3">
                    {hero.location_accounts && (
                      <Link to={`/feed/profile/${hero.location_accounts.handle.replace(/^@/, "")}`} className="hover:text-primary">
                        {hero.location_accounts.handle}
                      </Link>
                    )}
                    <span>·</span>
                    <span>{timeAgo(hero.posted_at)}</span>
                  </div>
                </div>
              </article>

              <div className="space-y-3">
                {secondary.map((s) => (
                  <article key={s.id} className="rounded-xl border border-border bg-card/50 p-4 hover:border-primary/40 transition">
                    <Badge variant="outline" className="text-[10px] mb-2">#{s.headline_rank}</Badge>
                    <p className="font-display text-base leading-snug line-clamp-3">{s.content}</p>
                    <div className="text-[11px] text-muted-foreground mt-2">{s.location_accounts?.handle} · {timeAgo(s.posted_at)}</div>
                  </article>
                ))}
                {secondary.length === 0 && (
                  <div className="text-xs text-muted-foreground border border-dashed rounded-xl p-4 text-center">
                    Promote more posts to fill secondary slots
                  </div>
                )}
              </div>
            </div>
          )}
        </section>

        {/* Trending rail */}
        {trending.length > 0 && (
          <section>
            <SectionHeader icon={<Sparkles className="w-4 h-4" />} title="Trending now" link="/feed" />
            <div className="flex gap-3 overflow-x-auto pb-3 -mx-4 px-4 snap-x">
              {trending.map((t) => (
                <article key={t.id} className="snap-start shrink-0 w-72 rounded-xl border border-border bg-card/50 p-4">
                  <Badge variant="secondary" className="text-[10px] mb-2">{t.event_type ?? "news"}</Badge>
                  <p className="text-sm line-clamp-4">{t.content}</p>
                  <div className="text-[11px] text-muted-foreground mt-2">{t.location_accounts?.handle ?? ""} · {timeAgo(t.posted_at)}</div>
                </article>
              ))}
            </div>
          </section>
        )}

        {/* Storylines */}
        {storylines.length > 0 && (
          <section>
            <SectionHeader icon={<Newspaper className="w-4 h-4" />} title="Storylines" />
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {storylines.map((s: any) => (
                <article key={s.id} className="rounded-xl border border-border bg-card/50 p-4 hover:border-primary/40 transition">
                  <Badge variant={s.status === "active" ? "default" : "outline"} className="text-[10px] mb-2">{s.status}</Badge>
                  <h3 className="font-display text-lg leading-tight">{s.title}</h3>
                  {s.summary && <p className="text-xs text-muted-foreground mt-1 line-clamp-3">{s.summary}</p>}
                </article>
              ))}
            </div>
          </section>
        )}

        {/* Recent moves & results */}
        <section className="grid md:grid-cols-2 gap-4">
          <div>
            <SectionHeader icon={<Star className="w-4 h-4" />} title="Recent moves" />
            <Card><CardContent className="p-3 space-y-2">
              {signings.length === 0 && <p className="text-xs text-muted-foreground">No signings yet.</p>}
              {signings.map((s) => (
                <div key={s.id} className="text-sm border-b border-border last:border-0 pb-2 last:pb-0">
                  <div className="line-clamp-2">{s.content}</div>
                  <div className="text-[10px] text-muted-foreground">{timeAgo(s.posted_at)}</div>
                </div>
              ))}
            </CardContent></Card>
          </div>
          <div>
            <SectionHeader icon={<Trophy className="w-4 h-4" />} title="Game results" />
            <Card><CardContent className="p-3 space-y-2">
              {results.length === 0 && <p className="text-xs text-muted-foreground">No results yet.</p>}
              {results.map((s) => (
                <div key={s.id} className="text-sm border-b border-border last:border-0 pb-2 last:pb-0">
                  <div className="line-clamp-2">{s.content}</div>
                  <div className="text-[10px] text-muted-foreground">{timeAgo(s.posted_at)}</div>
                </div>
              ))}
            </CardContent></Card>
          </div>
        </section>
      </main>
    </div>
  );
}

function SectionHeader({ icon, title, link }: { icon: React.ReactNode; title: string; link?: string }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <h2 className="font-display text-xl tracking-wider flex items-center gap-2">{icon} {title}</h2>
      {link && (
        <Link to={link} className="text-xs text-primary flex items-center gap-1 hover:underline">
          View all <ArrowRight className="w-3 h-3" />
        </Link>
      )}
    </div>
  );
}
