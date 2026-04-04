import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DataTable, Column } from "@/components/admin/DataTable";
import { FormDialog } from "@/components/admin/FormDialog";
import { ConfirmDialog } from "@/components/admin/ConfirmDialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
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
  created_at: string;
}

interface PlayerOption {
  id: string;
  name: string;
  social_handle: string | null;
}

const POST_TYPES = ["tweet", "story", "announcement"];

const emptyForm = (): Partial<SocialPost> => ({
  player_card_id: null,
  content: "",
  image_url: null,
  likes_count: Math.floor(Math.random() * 500) + 10,
  comments_count: Math.floor(Math.random() * 80),
  post_type: "tweet",
});

export default function AdminSocialFeed() {
  const qc = useQueryClient();
  const [form, setForm] = useState(emptyForm());
  const [editId, setEditId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const { data: posts = [], isLoading } = useQuery({
    queryKey: ["admin-social-posts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("social_posts")
        .select("*")
        .order("posted_at", { ascending: false });
      if (error) throw error;
      return data as SocialPost[];
    },
  });

  const { data: players = [] } = useQuery({
    queryKey: ["social-players"],
    queryFn: async () => {
      const { data } = await supabase
        .from("player_cards")
        .select("id, name, social_handle")
        .order("name");
      return (data ?? []) as PlayerOption[];
    },
  });

  const playerMap = Object.fromEntries(players.map((p) => [p.id, p]));

  const saveMut = useMutation({
    mutationFn: async () => {
      const payload: any = {
        player_card_id: form.player_card_id || null,
        content: form.content,
        image_url: form.image_url || null,
        likes_count: form.likes_count ?? 0,
        comments_count: form.comments_count ?? 0,
        post_type: form.post_type ?? "tweet",
      };
      if (editId) {
        const { error } = await supabase.from("social_posts").update(payload).eq("id", editId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("social_posts").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-social-posts"] });
      setDialogOpen(false);
      toast.success(editId ? "Post updated" : "Post created");
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("social_posts").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-social-posts"] });
      setDeleteId(null);
      toast.success("Post deleted");
    },
    onError: (e) => toast.error(e.message),
  });

  const columns: Column<SocialPost>[] = [
    {
      key: "player_card_id",
      label: "Player",
      render: (r) => {
        const p = playerMap[r.player_card_id ?? ""];
        return p ? `${p.social_handle ?? p.name}` : "🏀 League";
      },
    },
    {
      key: "content",
      label: "Content",
      render: (r) => r.content.length > 60 ? r.content.slice(0, 60) + "…" : r.content,
    },
    { key: "post_type", label: "Type" },
    {
      key: "posted_at",
      label: "Posted",
      sortable: true,
      render: (r) => formatDistanceToNow(new Date(r.posted_at), { addSuffix: true }),
    },
  ];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Social Feed Manager</CardTitle>
          <CardDescription>Create fictional social media posts attributed to player cards.</CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            data={posts}
            columns={columns}
            isLoading={isLoading}
            searchKeys={["content"]}
            searchPlaceholder="Search posts…"
            onAdd={() => { setForm(emptyForm()); setEditId(null); setDialogOpen(true); }}
            addLabel="New Post"
            actions={(row) => (
              <div className="flex gap-1">
                <Button size="icon" variant="ghost" onClick={() => { setForm(row); setEditId(row.id); setDialogOpen(true); }}>
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button size="icon" variant="ghost" onClick={() => setDeleteId(row.id)}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            )}
          />
        </CardContent>
      </Card>

      <FormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={editId ? "Edit Post" : "New Post"}
        onSave={() => saveMut.mutate()}
        saving={saveMut.isPending}
      >
        <div className="space-y-4 p-1">
          <div className="space-y-1">
            <Label>Player (optional)</Label>
            <Select
              value={form.player_card_id ?? "none"}
              onValueChange={(v) => setForm((f) => ({ ...f, player_card_id: v === "none" ? null : v }))}
            >
              <SelectTrigger><SelectValue placeholder="League post" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">🏀 League Post</SelectItem>
                {players.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.social_handle ?? p.name} — {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Content</Label>
            <Textarea
              value={form.content ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
              rows={4}
              placeholder="What's happening in the league…"
            />
          </div>
          <div className="space-y-1">
            <Label>Image URL (optional)</Label>
            <Input
              value={form.image_url ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, image_url: e.target.value || null }))}
              placeholder="https://…"
            />
          </div>
          <div className="space-y-1">
            <Label>Post Type</Label>
            <Select value={form.post_type ?? "tweet"} onValueChange={(v) => setForm((f) => ({ ...f, post_type: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {POST_TYPES.map((t) => (
                  <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>Likes</Label>
              <Input
                type="number"
                min={0}
                value={form.likes_count ?? 0}
                onChange={(e) => setForm((f) => ({ ...f, likes_count: Number(e.target.value) || 0 }))}
              />
            </div>
            <div className="space-y-1">
              <Label>Comments</Label>
              <Input
                type="number"
                min={0}
                value={form.comments_count ?? 0}
                onChange={(e) => setForm((f) => ({ ...f, comments_count: Number(e.target.value) || 0 }))}
              />
            </div>
          </div>
        </div>
      </FormDialog>

      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={() => setDeleteId(null)}
        title="Delete Post"
        description="Remove this post from the feed?"
        onConfirm={() => deleteId && deleteMut.mutate(deleteId)}
        loading={deleteMut.isPending}
      />
    </div>
  );
}
