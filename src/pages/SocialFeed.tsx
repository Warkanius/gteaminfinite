import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Heart,
  MessageCircle,
  Megaphone,
  Repeat2,
  Send,
  Bookmark,
  BadgeCheck,
  MoreHorizontal,
} from "lucide-react";
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
        if (post.post_type === "tweet") return <TweetPost key={post.id} post={post} />;
        if (post.post_type === "instagram") return <InstagramPost key={post.id} post={post} />;
        if (post.post_type === "announcement") return <AnnouncementPost key={post.id} post={post} />;
        return <TweetPost key={post.id} post={post} />;
      })}

      {!isLoading && posts.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          No posts yet — check back later!
        </div>
      )}
    </div>
  );
}

/* ── Tweet ───────────────────────────────────────────── */

function TweetPost({ post }: { post: SocialPost }) {
  const player = post.player_cards;
  const handle = player?.social_handle ?? `@${player?.name ?? "GTeamLeague"}`;
  const displayName = player?.name ?? "GTeam League";
  const accent = player?.card_color_primary ?? "hsl(var(--primary))";
  const retweetCount = Math.floor(post.likes_count * 0.4);

  return (
    <Card className="overflow-hidden" style={{ borderTopColor: accent, borderTopWidth: 3 }}>
      <div className="p-4 space-y-2.5">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2.5">
            <div
              className="h-10 w-10 rounded-full flex items-center justify-center text-sm font-bold text-white shrink-0"
              style={{ background: accent }}
            >
              {displayName[0]?.toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1">
                <span className="font-semibold text-sm truncate">{displayName}</span>
                <BadgeCheck className="h-3.5 w-3.5 text-primary shrink-0" />
              </div>
              <span className="text-xs text-muted-foreground">{handle} · {formatDistanceToNow(new Date(post.posted_at), { addSuffix: true })}</span>
            </div>
          </div>
          <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
        </div>

        {/* Content */}
        <p className="text-sm whitespace-pre-wrap leading-relaxed">{post.content}</p>

        {/* Optional image */}
        {post.image_url && (
          <img src={post.image_url} alt="" className="rounded-xl w-full max-h-64 object-cover border border-border" loading="lazy" />
        )}

        {/* Engagement */}
        <div className="flex items-center justify-between text-muted-foreground text-xs pt-1 px-2">
          <span className="flex items-center gap-1 hover:text-primary cursor-pointer">
            <MessageCircle className="h-4 w-4" /> {post.comments_count.toLocaleString()}
          </span>
          <span className="flex items-center gap-1 hover:text-green-500 cursor-pointer">
            <Repeat2 className="h-4 w-4" /> {retweetCount.toLocaleString()}
          </span>
          <span className="flex items-center gap-1 hover:text-red-500 cursor-pointer">
            <Heart className="h-4 w-4" /> {post.likes_count.toLocaleString()}
          </span>
          <Bookmark className="h-4 w-4 hover:text-primary cursor-pointer" />
        </div>
      </div>
    </Card>
  );
}

/* ── Instagram ───────────────────────────────────────── */

function InstagramPost({ post }: { post: SocialPost }) {
  const player = post.player_cards;
  const handle = player?.social_handle?.replace("@", "") ?? player?.name ?? "gteamleague";
  const accent = player?.card_color_primary ?? "hsl(var(--primary))";

  return (
    <Card className="overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-3 py-2.5">
        <div
          className="h-9 w-9 rounded-full ring-2 ring-pink-500 ring-offset-2 ring-offset-background flex items-center justify-center text-xs font-bold text-white shrink-0"
          style={{ background: accent }}
        >
          {handle[0]?.toUpperCase()}
        </div>
        <span className="font-semibold text-sm flex-1 truncate">{handle}</span>
        <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
      </div>

      {/* Image */}
      {post.image_url ? (
        <img src={post.image_url} alt="" className="w-full aspect-square object-cover" loading="lazy" />
      ) : (
        <div className="w-full aspect-[4/3] bg-muted flex items-center justify-center text-muted-foreground text-sm">
          No image
        </div>
      )}

      {/* Actions */}
      <div className="px-3 pt-2.5 space-y-1.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Heart className="h-5 w-5 hover:text-red-500 cursor-pointer" />
            <MessageCircle className="h-5 w-5 hover:text-primary cursor-pointer" />
            <Send className="h-5 w-5 hover:text-primary cursor-pointer" />
          </div>
          <Bookmark className="h-5 w-5 hover:text-primary cursor-pointer" />
        </div>

        <p className="text-sm font-semibold">{post.likes_count.toLocaleString()} likes</p>

        {/* Caption */}
        <p className="text-sm pb-2.5">
          <span className="font-semibold mr-1">{handle}</span>
          {post.content}
        </p>

        {post.comments_count > 0 && (
          <p className="text-xs text-muted-foreground pb-2">
            View all {post.comments_count.toLocaleString()} comments
          </p>
        )}

        <p className="text-[10px] text-muted-foreground uppercase tracking-wide pb-3 border-b border-border">
          {formatDistanceToNow(new Date(post.posted_at), { addSuffix: true })}
        </p>
      </div>
    </Card>
  );
}

/* ── Announcement ────────────────────────────────────── */

function AnnouncementPost({ post }: { post: SocialPost }) {
  return (
    <Card className="overflow-hidden bg-gradient-to-br from-primary/15 via-accent/10 to-primary/5 border-primary/30">
      <div className="p-5 space-y-3 text-center">
        <div className="flex items-center justify-center gap-2">
          <Megaphone className="h-5 w-5 text-primary" />
          <Badge variant="outline" className="text-[10px] uppercase tracking-widest font-bold border-primary/40 text-primary">
            League Announcement
          </Badge>
          <Megaphone className="h-5 w-5 text-primary scale-x-[-1]" />
        </div>
        <p className="text-sm font-semibold whitespace-pre-wrap leading-relaxed">{post.content}</p>
        {post.image_url && (
          <img src={post.image_url} alt="" className="rounded-lg w-full max-h-52 object-cover mx-auto" loading="lazy" />
        )}
        <p className="text-[10px] text-muted-foreground uppercase tracking-wide">
          {formatDistanceToNow(new Date(post.posted_at), { addSuffix: true })}
        </p>
      </div>
    </Card>
  );
}
