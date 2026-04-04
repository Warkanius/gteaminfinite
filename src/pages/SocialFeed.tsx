import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Heart, MessageCircle, Megaphone, Sparkles } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface SocialPost {
  id: string;
  player_card_id: string | null;
  content: string;
  image_url: string | null;
  likes_count: number;
  comments_count: number;
  post_type: string;
  posted_at: string;
  player_cards: {
    name: string;
    social_handle: string | null;
    card_color_primary: string | null;
    rating: number;
    position1: string | null;
  } | null;
}

export default function SocialFeed() {
  const { data: posts = [], isLoading } = useQuery({
    queryKey: ["social-feed"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("social_posts")
        .select("*, player_cards(name, social_handle, card_color_primary, rating, position1)")
        .order("posted_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data as SocialPost[];
    },
  });

  const typeIcon = (type: string) => {
    if (type === "announcement") return <Megaphone className="h-3.5 w-3.5" />;
    if (type === "story") return <Sparkles className="h-3.5 w-3.5" />;
    return null;
  };

  return (
    <div className="max-w-lg mx-auto space-y-4">
      <h1 className="text-2xl font-display font-bold tracking-wide">Feed</h1>
      <p className="text-sm text-muted-foreground">Latest from around the league</p>

      {isLoading && (
        <div className="flex justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      )}

      {posts.map((post) => {
        const player = post.player_cards;
        const handle = player?.social_handle ?? player?.name ?? "GTeam League";
        const accentColor = player?.card_color_primary ?? "hsl(var(--primary))";

        return (
          <Card key={post.id} className="overflow-hidden">
            <div className="p-4 space-y-3">
              {/* Header */}
              <div className="flex items-center gap-3">
                <div
                  className="h-10 w-10 rounded-full flex items-center justify-center text-sm font-bold text-white shrink-0"
                  style={{ background: accentColor }}
                >
                  {(handle[0] === "@" ? handle[1] : handle[0])?.toUpperCase() ?? "G"}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm truncate">{handle}</span>
                    {post.post_type !== "tweet" && (
                      <Badge variant="outline" className="text-[10px] gap-1 px-1.5 py-0">
                        {typeIcon(post.post_type)}
                        {post.post_type}
                      </Badge>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(post.posted_at), { addSuffix: true })}
                  </span>
                </div>
              </div>

              {/* Content */}
              <p className="text-sm whitespace-pre-wrap">{post.content}</p>

              {/* Image */}
              {post.image_url && (
                <img
                  src={post.image_url}
                  alt=""
                  className="rounded-lg w-full max-h-64 object-cover"
                  loading="lazy"
                />
              )}

              {/* Engagement */}
              <div className="flex items-center gap-5 text-muted-foreground text-xs pt-1">
                <span className="flex items-center gap-1">
                  <Heart className="h-3.5 w-3.5" /> {post.likes_count.toLocaleString()}
                </span>
                <span className="flex items-center gap-1">
                  <MessageCircle className="h-3.5 w-3.5" /> {post.comments_count.toLocaleString()}
                </span>
              </div>
            </div>
          </Card>
        );
      })}

      {!isLoading && posts.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          No posts yet — check back later!
        </div>
      )}
    </div>
  );
}
