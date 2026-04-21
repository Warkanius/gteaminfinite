import * as React from "react";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Heart, MessageCircle, Megaphone, Repeat2, Send, Bookmark,
  BadgeCheck, MoreHorizontal, Play,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface SocialCreator {
  id?: string;
  name: string;
  handle: string;
  accent_color?: string | null;
  avatar_url?: string | null;
}

export interface FeedPost {
  id: string;
  player_card_id: string | null;
  creator_id: string | null;
  location_account_id?: string | null;
  event_type?: string | null;
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
  location_accounts?: SocialCreator | null;
}

const LEAGUE_NAME = "GTeam League";
const LEAGUE_HANDLE = "@GTeamLeague";
const LEAGUE_ACCENT = "hsl(var(--primary))";

function ProfileAvatar({ name, accent, avatarUrl, size = "md", className = "" }: {
  name: string; accent: string; avatarUrl?: string | null; size?: "sm" | "md"; className?: string;
}) {
  const dims = size === "sm" ? "h-9 w-9 text-xs" : "h-10 w-10 text-sm";
  return (
    <div
      className={`${dims} rounded-full shrink-0 overflow-hidden ${avatarUrl ? "" : "flex items-center justify-center font-bold text-white"} ${className}`}
      style={avatarUrl ? undefined : { background: accent }}
    >
      {avatarUrl ? <img src={avatarUrl} alt={name} className="h-full w-full object-cover" /> : name[0]?.toUpperCase()}
    </div>
  );
}

function HandleLink({ handle, name, className = "" }: { handle?: string | null; name: string; className?: string; }) {
  if (!handle) return <span className={className}>{name}</span>;
  const cleanHandle = handle.startsWith("@") ? handle : `@${handle}`;
  return (
    <Link
      to={`/feed/profile/${encodeURIComponent(cleanHandle)}`}
      className={`hover:underline hover:text-primary transition-colors ${className}`}
      onClick={(e) => e.stopPropagation()}
    >
      {name}
    </Link>
  );
}

function formatViews(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function resolveAttribution(post: FeedPost) {
  // Location account takes precedence (system-generated league/road/run posts)
  const loc = post.location_accounts;
  const creator = post.social_creators;
  const player = post.player_cards;
  return {
    name: loc?.name ?? creator?.name ?? player?.name ?? LEAGUE_NAME,
    handle: loc?.handle ?? creator?.handle ?? player?.social_handle ?? LEAGUE_HANDLE,
    accent: loc?.accent_color ?? creator?.accent_color ?? player?.card_color_primary ?? LEAGUE_ACCENT,
    avatarUrl: loc?.avatar_url ?? creator?.avatar_url ?? player?.avatar_url ?? null,
    isVenue: !!loc,
  };
}

function YouTubePost({ post }: { post: FeedPost }) {
  const a = resolveAttribution(post);
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
      </div>
      <div className="flex gap-3 p-3">
        <ProfileAvatar name={a.name} accent={a.accent} avatarUrl={a.avatarUrl} size="sm" className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-snug line-clamp-2">{post.content}</p>
          <p className="text-xs text-muted-foreground mt-1">
            <HandleLink handle={a.handle} name={a.name} /> · {formatViews(post.likes_count)} views · {formatDistanceToNow(new Date(post.posted_at), { addSuffix: true })}
          </p>
        </div>
      </div>
    </Card>
  );
}

function TweetPost({ post }: { post: FeedPost }) {
  const a = resolveAttribution(post);
  const retweetCount = Math.floor(post.likes_count * 0.4);
  return (
    <Card className="overflow-hidden" style={{ borderTopColor: a.accent, borderTopWidth: 3 }}>
      <div className="p-4 space-y-2.5">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2.5">
            <ProfileAvatar name={a.name} accent={a.accent} avatarUrl={a.avatarUrl} />
            <div className="min-w-0">
              <div className="flex items-center gap-1">
                <span className="font-semibold text-sm truncate">{a.name}</span>
                <BadgeCheck className="h-3.5 w-3.5 text-primary shrink-0" />
                {a.isVenue && <Badge variant="outline" className="text-[9px] px-1 py-0">Venue</Badge>}
              </div>
              <span className="text-xs text-muted-foreground">
                <HandleLink handle={a.handle} name={a.handle.startsWith("@") ? a.handle : `@${a.handle}`} /> · {formatDistanceToNow(new Date(post.posted_at), { addSuffix: true })}
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

function InstagramPost({ post }: { post: FeedPost }) {
  const a = resolveAttribution(post);
  const displayHandle = a.handle.replace(/^@/, "");
  const linkHandle = a.handle.startsWith("@") ? a.handle : `@${a.handle}`;
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-3 px-3 py-2.5">
        <ProfileAvatar name={displayHandle} accent={a.accent} avatarUrl={a.avatarUrl} size="sm" className="ring-2 ring-pink-500 ring-offset-2 ring-offset-background" />
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

function AnnouncementPost({ post }: { post: FeedPost }) {
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

export function PostCard({ post }: { post: FeedPost }) {
  if (post.post_type === "youtube") return <YouTubePost post={post} />;
  if (post.post_type === "instagram") return <InstagramPost post={post} />;
  if (post.post_type === "announcement") return <AnnouncementPost post={post} />;
  return <TweetPost post={post} />;
}

/** Columns for queries: pull location_accounts in addition to existing relations. */
export const POST_SELECT =
  "*, player_cards(name, social_handle, card_color_primary, rating, position1, avatar_url), social_creators(id, name, handle, accent_color, avatar_url), location_accounts(id, name, handle, accent_color, avatar_url)";
