import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PostCard, POST_SELECT, type FeedPost } from "@/components/social/PostCard";

export default function SocialFeed() {
  const { data: posts = [], isLoading } = useQuery({
    queryKey: ["social-feed"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("social_posts")
        .select(POST_SELECT)
        .eq("is_published", true)
        .order("posted_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data as unknown as FeedPost[];
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

      {posts.map((post) => <PostCard key={post.id} post={post} />)}

      {!isLoading && posts.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">No posts yet — check back later!</div>
      )}
    </div>
  );
}
