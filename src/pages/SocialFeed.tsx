import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Link } from "react-router-dom";
import {
  Heart,
  MessageCircle,
  Megaphone,
  Repeat2,
  Send,
  Bookmark,
  BadgeCheck,
  MoreHorizontal,
  Play,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface SocialCreator {
  id: string;
  name: string;
  handle: string;
  accent_color: string | null;
  avatar_url: string | null;
}

interface SocialPost {
  id: string;
  player_card_id: string | null;
  creator_id: string | null;
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
    avatar_url: string | null;
  } | null;
  social_creators: SocialCreator | null;
}

const LEAGUE_NAME = "GTeam League";
const LEAGUE_HANDLE = "@GTeamLeague";
const LEAGUE_ACCENT = "hsl(var(--primary))";

export default function SocialFeed() {
  const { data: posts = [], isLoading } = useQuery({
    queryKey: ["social-feed"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("social_posts")
        .select("*, player_cards(name, social_handle, card_color_primary, rating, position1, avatar_url), social_creators(id, name, handle, accent_color, avatar_url)")
        .order("posted_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data as unknown as SocialPost[];
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
        if (post.post_type === "youtube") return <YouTubePost key={post.id} post={post} />;
        if (post.post_type === "tweet") return <TweetPost key={post.id} post={post} />;
        if (post.post_type === "instagram") return <InstagramPost key={post.id} post={post} />;
        if (post.post_type === "announcement") return <AnnouncementPost key={post.id} post={post} />;
        return <TweetPost key={post.id} post={post} />;
      })}

      {!isLoading && posts.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">No posts yet — check back later!</div>
      )}
    </div>
  );
}

interface ProfileAvatarProps {
  name: string;
  accent: string;
  avatarUrl?: string | null;
  size?: "sm" | "md";
  className?: string;
}

const ProfileAvatar = React.forwardRef<HTMLDivElement, ProfileAvatarProps>(
  ({ name, accent, avatarUrl, size = "md", className = "" }, ref) => {
    const dims = size === "sm" ? "h-9 w-9 text-xs" : "h-10 w-10 text-sm";

    return (
      <div
        ref={ref}
        className={`${dims} rounded-full shrink-0 overflow-hidden ${avatarUrl ? "" : "flex items-center justify-center font-bold text-white"} ${className}`}
        style={avatarUrl ? undefined : { background: accent }}
      >
        {avatarUrl ? <img src={avatarUrl} alt={name} className="h-full w-full object-cover" /> : name[0]?.toUpperCase()}
      </div>
    );
  },
);
ProfileAvatar.displayName = "ProfileAvatar";

interface HandleLinkProps {
  handle?: string | null;
  name: string;
  className?: string;
}

const HandleLink = React.forwardRef<HTMLAnchorElement, HandleLinkProps>(
  ({ handle, name, className = "" }, ref) => {
    if (!handle) return <span className={className}>{name}</span>;
    const cleanHandle = handle.startsWith("@") ? handle : `@${handle}`;

    return (
      <Link
        ref={ref}
        to={`/feed/profile/${encodeURIComponent(cleanHandle)}`}
        className={`hover:underline hover:text-primary transition-colors ${className}`}
        onClick={(e) => e.stopPropagation()}
      >
        {name}
      </Link>
    );
  },
);
HandleLink.displayName = "HandleLink";

function formatViews(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function YouTubePost({ post }: { post: SocialPost }) {
  const creator = post.social_creators;
  const player = post.player_cards;
  const channelName = creator?.name ?? player?.name ?? LEAGUE_NAME;
  const channelHandle = creator?.handle ?? player?.social_handle ?? LEAGUE_HANDLE;
  const accent = creator?.accent_color ?? player?.card_color_primary ?? LEAGUE_ACCENT;
  const avatarUrl = creator?.avatar_url ?? player?.avatar_url;

  return (
    <Card className="overflow-hidden">
      <div className="relative w-full aspect-video bg-muted">
        {post.image_url ? (
          <img src={post.image_url} alt="" className="w-full h-full object-cover" loading="lazy" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted-foreground text-sm">No thumbnail</div>
        )}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="h-14 w-14 rounded-full bg-black/70 flex items-center justify-center backdrop-blur-sm">
            <Play className="h-7 w-7 text-white fill-white ml-1" />
          </div>
        </div>
        <div className="absolute bottom-2 right-2 bg-black/80 text-white text-[11px] font-medium px-1.5 py-0.5 rounded">
          {post.comments_count > 0 ? `${Math.floor(post.comments_count / 60)}:${String(post.comments_count % 60).padStart(2, "0")}` : "12:34"}
        </div>
      </div>
      <div className="flex gap-3 p-3">
        <ProfileAvatar name={channelName} accent={accent} avatarUrl={avatarUrl} size="sm" className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-snug line-clamp-2">{post.content}</p>
          <p className="text-xs text-muted-foreground mt-1">
            <HandleLink handle={channelHandle} name={channelName} /> · {formatViews(post.likes_count)} views · {formatDistanceToNow(new Date(post.posted_at), { addSuffix: true })}
          </p>
        </div>
      </div>
    </Card>
  );
}

function TweetPost({ post }: { post: SocialPost }) {
  const creator = post.social_creators;
  const player = post.player_cards;
  const displayName = creator?.name ?? player?.name ?? LEAGUE_NAME;
  const handle = creator?.handle ?? player?.social_handle ?? LEAGUE_HANDLE;
  const accent = creator?.accent_color ?? player?.card_color_primary ?? LEAGUE_ACCENT;
  const avatarUrl = creator?.avatar_url ?? player?.avatar_url;
  const retweetCount = Math.floor(post.likes_count * 0.4);

  return (
    <Card className="overflow-hidden" style={{ borderTopColor: accent, borderTopWidth: 3 }}>
      <div className="p-4 space-y-2.5">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2.5">
            <ProfileAvatar name={displayName} accent={accent} avatarUrl={avatarUrl} />
            <div className="min-w-0">
              <div className="flex items-center gap-1">
                <span className="font-semibold text-sm truncate">{displayName}</span>
                <BadgeCheck className="h-3.5 w-3.5 text-primary shrink-0" />
              </div>
              <span className="text-xs text-muted-foreground">
                <HandleLink handle={handle} name={handle.startsWith("@") ? handle : `@${handle}`} /> · {formatDistanceToNow(new Date(post.posted_at), { addSuffix: true })}
              </span>
            </div>
          </div>
          <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
        </div>
        <p className="text-sm whitespace-pre-wrap leading-relaxed">{post.content}</p>
        {post.image_url && <img src={post.image_url} alt="" className="rounded-xl w-full max-h-64 object-cover border border-border" loading="lazy" />}
        <div className="flex items-center justify-between text-muted-foreground text-xs pt-1 px-2">
          <span className="flex items-center gap-1 hover:text-primary cursor-pointer"><MessageCircle className="h-4 w-4" /> {post.comments_count.toLocaleString()}</span>
          <span className="flex items-center gap-1 hover:text-green-500 cursor-pointer"><Repeat2 className="h-4 w-4" /> {retweetCount.toLocaleString()}</span>
          <span className="flex items-center gap-1 hover:text-red-500 cursor-pointer"><Heart className="h-4 w-4" /> {post.likes_count.toLocaleString()}</span>
          <Bookmark className="h-4 w-4 hover:text-primary cursor-pointer" />
        </div>
      </div>
    </Card>
  );
}

function InstagramPost({ post }: { post: SocialPost }) {
  const creator = post.social_creators;
  const player = post.player_cards;
  const rawHandle = creator?.handle ?? player?.social_handle ?? LEAGUE_HANDLE;
  const displayHandle = rawHandle.replace(/^@/, "");
  const linkHandle = rawHandle.startsWith("@") ? rawHandle : `@${rawHandle}`;
  const accent = creator?.accent_color ?? player?.card_color_primary ?? LEAGUE_ACCENT;
  const avatarUrl = creator?.avatar_url ?? player?.avatar_url;

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-3 px-3 py-2.5">
        <ProfileAvatar name={displayHandle} accent={accent} avatarUrl={avatarUrl} size="sm" className="ring-2 ring-pink-500 ring-offset-2 ring-offset-background" />
        <HandleLink handle={linkHandle} name={displayHandle} className="font-semibold text-sm flex-1 truncate" />
        <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
      </div>
      {post.image_url ? (
        <img src={post.image_url} alt="" className="w-full aspect-square object-cover" loading="lazy" />
      ) : (
        <div className="w-full aspect-[4/3] bg-muted flex items-center justify-center text-muted-foreground text-sm">No image</div>
      )}
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
        <p className="text-sm pb-2.5">
          <HandleLink handle={linkHandle} name={displayHandle} className="font-semibold mr-1" />
          {post.content}
        </p>
        {post.comments_count > 0 && <p className="text-xs text-muted-foreground pb-2">View all {post.comments_count.toLocaleString()} comments</p>}
        <p className="text-[10px] text-muted-foreground uppercase tracking-wide pb-3 border-b border-border">
          {formatDistanceToNow(new Date(post.posted_at), { addSuffix: true })}
        </p>
      </div>
    </Card>
  );
}

function AnnouncementPost({ post }: { post: SocialPost }) {
  return (
    <Card className="overflow-hidden bg-gradient-to-br from-primary/15 via-accent/10 to-primary/5 border-primary/30">
      <div className="p-5 space-y-3 text-center">
        <div className="flex items-center justify-center gap-2">
          <Megaphone className="h-5 w-5 text-primary" />
          <Badge variant="outline" className="text-[10px] uppercase tracking-widest font-bold border-primary/40 text-primary">League Announcement</Badge>
          <Megaphone className="h-5 w-5 text-primary scale-x-[-1]" />
        </div>
        <p className="text-sm font-semibold whitespace-pre-wrap leading-relaxed">{post.content}</p>
        {post.image_url && <img src={post.image_url} alt="" className="rounded-lg w-full max-h-52 object-cover mx-auto" loading="lazy" />}
        <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{formatDistanceToNow(new Date(post.posted_at), { addSuffix: true })}</p>
      </div>
    </Card>
  );
}
