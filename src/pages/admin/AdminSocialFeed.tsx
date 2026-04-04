import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DataTable, Column } from "@/components/admin/DataTable";
import { FormDialog } from "@/components/admin/FormDialog";
import { ConfirmDialog } from "@/components/admin/ConfirmDialog";
import { HslColorPicker } from "@/components/admin/HslColorPicker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Pencil, Trash2, Upload, X, Users } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";

/* ── Types ─────────────────────────────────── */

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
  created_at: string;
}

interface PlayerOption { id: string; name: string; social_handle: string | null; }

interface Creator {
  id: string;
  name: string;
  handle: string;
  accent_color: string | null;
  avatar_url: string | null;
  created_at: string;
}

const POST_TYPES = ["tweet", "instagram", "announcement", "youtube"];

const emptyForm = (): Partial<SocialPost> => ({
  player_card_id: null,
  creator_id: null,
  content: "",
  image_url: null,
  likes_count: Math.floor(Math.random() * 500) + 10,
  comments_count: Math.floor(Math.random() * 80),
  post_type: "tweet",
});

const emptyCreator = (): Partial<Creator> => ({
  name: "",
  handle: "",
  accent_color: "hsl(0, 70%, 50%)",
});

/* ── Main ──────────────────────────────────── */

export default function AdminSocialFeed() {
  const qc = useQueryClient();
  const [form, setForm] = useState(emptyForm());
  const [editId, setEditId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Creator state
  const [creatorDialogOpen, setCreatorDialogOpen] = useState(false);
  const [creatorForm, setCreatorForm] = useState(emptyCreator());
  const [creatorEditId, setCreatorEditId] = useState<string | null>(null);
  const [creatorDeleteId, setCreatorDeleteId] = useState<string | null>(null);
  const [creatorsOpen, setCreatorsOpen] = useState(false);

  /* ── Queries ─────────────────────────────── */

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
      const { data } = await supabase.from("player_cards").select("id, name, social_handle").order("name");
      return (data ?? []) as PlayerOption[];
    },
  });

  const { data: creators = [] } = useQuery({
    queryKey: ["social-creators"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("social_creators")
        .select("*")
        .order("name");
      if (error) throw error;
      return data as Creator[];
    },
  });

  const playerMap = Object.fromEntries(players.map((p) => [p.id, p]));
  const creatorMap = Object.fromEntries(creators.map((c) => [c.id, c]));

  /* ── Image upload ────────────────────────── */

  const handleImageUpload = async (file: File) => {
    setUploading(true);
    try {
      const ext = file.name.split(".").pop();
      const path = `${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage.from("social-images").upload(path, file);
      if (error) throw error;
      const { data: urlData } = supabase.storage.from("social-images").getPublicUrl(path);
      setForm((f) => ({ ...f, image_url: urlData.publicUrl }));
      toast.success("Image uploaded");
    } catch (e: any) {
      toast.error(e.message ?? "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  /* ── Post mutations ──────────────────────── */

  const saveMut = useMutation({
    mutationFn: async () => {
      const isYoutube = form.post_type === "youtube";
      const payload: any = {
        player_card_id: isYoutube ? null : (form.player_card_id || null),
        creator_id: isYoutube ? (form.creator_id || null) : null,
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

  /* ── Creator mutations ───────────────────── */

  const saveCreatorMut = useMutation({
    mutationFn: async () => {
      const payload = {
        name: creatorForm.name ?? "",
        handle: creatorForm.handle ?? "",
        accent_color: creatorForm.accent_color ?? "hsl(0, 70%, 50%)",
      };
      if (creatorEditId) {
        const { error } = await supabase.from("social_creators").update(payload).eq("id", creatorEditId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("social_creators").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["social-creators"] });
      setCreatorDialogOpen(false);
      toast.success(creatorEditId ? "Creator updated" : "Creator added");
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteCreatorMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("social_creators").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["social-creators"] });
      setCreatorDeleteId(null);
      toast.success("Creator deleted");
    },
    onError: (e) => toast.error(e.message),
  });

  /* ── Table columns ───────────────────────── */

  const columns: Column<SocialPost>[] = [
    {
      key: "player_card_id",
      label: "Attribution",
      render: (r) => {
        if (r.creator_id && creatorMap[r.creator_id]) return `🎬 ${creatorMap[r.creator_id].name}`;
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

  const isYoutube = form.post_type === "youtube";

  /* ── Render ──────────────────────────────── */

  return (
    <div className="space-y-6">
      {/* Posts Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Social Feed Manager</CardTitle>
              <CardDescription>Create fictional social media posts attributed to players or creators.</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={() => setCreatorsOpen(!creatorsOpen)}>
              <Users className="h-4 w-4 mr-2" /> Creators ({creators.length})
            </Button>
          </div>
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

      {/* Creators Panel */}
      {creatorsOpen && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Creators</CardTitle>
            <CardDescription>Non-player content creators (commentators, analysts, fan channels).</CardDescription>
          </CardHeader>
          <CardContent>
            <DataTable
              data={creators}
              columns={[
                { key: "name", label: "Name" },
                { key: "handle", label: "Handle" },
                {
                  key: "accent_color",
                  label: "Color",
                  render: (r) => (
                    <div className="h-5 w-5 rounded-full border border-border" style={{ background: r.accent_color ?? undefined }} />
                  ),
                },
              ] as Column<Creator>[]}
              isLoading={false}
              searchKeys={["name", "handle"]}
              searchPlaceholder="Search creators…"
              onAdd={() => { setCreatorForm(emptyCreator()); setCreatorEditId(null); setCreatorDialogOpen(true); }}
              addLabel="New Creator"
              actions={(row) => (
                <div className="flex gap-1">
                  <Button size="icon" variant="ghost" onClick={() => { setCreatorForm(row); setCreatorEditId(row.id); setCreatorDialogOpen(true); }}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => setCreatorDeleteId(row.id)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              )}
            />
          </CardContent>
        </Card>
      )}

      {/* ── Post Dialog ──────────────────────── */}
      <FormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={editId ? "Edit Post" : "New Post"}
        onSave={() => saveMut.mutate()}
        saving={saveMut.isPending}
      >
        <div className="space-y-4 p-1">
          {/* Post Type */}
          <div className="space-y-1">
            <Label>Post Type</Label>
            <Select value={form.post_type ?? "tweet"} onValueChange={(v) => setForm((f) => ({ ...f, post_type: v, player_card_id: null, creator_id: null }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {POST_TYPES.map((t) => (
                  <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Attribution */}
          {isYoutube ? (
            <div className="space-y-1">
              <Label>Creator</Label>
              <Select
                value={form.creator_id ?? "none"}
                onValueChange={(v) => setForm((f) => ({ ...f, creator_id: v === "none" ? null : v }))}
              >
                <SelectTrigger><SelectValue placeholder="Select creator" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">🏀 League Channel</SelectItem>
                  {creators.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.handle} — {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
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
          )}

          {/* Content */}
          <div className="space-y-1">
            <Label>{isYoutube ? "Video Title" : "Content"}</Label>
            <Textarea
              value={form.content ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
              rows={isYoutube ? 2 : 4}
              placeholder={isYoutube ? "Why Team X Will Dominate This Season…" : "What's happening in the league…"}
            />
          </div>

          {/* Image */}
          <div className="space-y-2">
            <Label>{isYoutube ? "Thumbnail" : "Image"}</Label>
            {form.image_url ? (
              <div className="relative rounded-md overflow-hidden border border-border">
                <img src={form.image_url} alt="Preview" className={`w-full object-cover ${isYoutube ? "aspect-video" : "max-h-48"}`} />
                <Button
                  size="icon"
                  variant="destructive"
                  className="absolute top-2 right-2 h-6 w-6"
                  onClick={() => setForm((f) => ({ ...f, image_url: null }))}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ) : (
              <div
                className="flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed border-muted-foreground/25 p-6 cursor-pointer hover:border-primary/50 transition-colors"
                onClick={() => fileRef.current?.click()}
              >
                {uploading ? (
                  <p className="text-sm text-muted-foreground">Uploading…</p>
                ) : (
                  <>
                    <Upload className="h-8 w-8 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">Click to upload {isYoutube ? "a thumbnail" : "an image"}</p>
                  </>
                )}
              </div>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleImageUpload(file);
                e.target.value = "";
              }}
            />
            <Input
              value={form.image_url ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, image_url: e.target.value || null }))}
              placeholder="Or paste a URL…"
              className="text-xs"
            />
          </div>

          {/* Engagement */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>{isYoutube ? "Views" : "Likes"}</Label>
              <Input
                type="number"
                min={0}
                value={form.likes_count ?? 0}
                onChange={(e) => setForm((f) => ({ ...f, likes_count: Number(e.target.value) || 0 }))}
              />
            </div>
            <div className="space-y-1">
              <Label>{isYoutube ? "Duration (sec)" : "Comments"}</Label>
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

      {/* ── Creator Dialog ───────────────────── */}
      <FormDialog
        open={creatorDialogOpen}
        onOpenChange={setCreatorDialogOpen}
        title={creatorEditId ? "Edit Creator" : "New Creator"}
        onSave={() => saveCreatorMut.mutate()}
        saving={saveCreatorMut.isPending}
        className="max-w-md"
      >
        <div className="space-y-4 p-1">
          <div className="space-y-1">
            <Label>Name</Label>
            <Input
              value={creatorForm.name ?? ""}
              onChange={(e) => setCreatorForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="HoopsTakeTV"
            />
          </div>
          <div className="space-y-1">
            <Label>Handle</Label>
            <Input
              value={creatorForm.handle ?? ""}
              onChange={(e) => setCreatorForm((f) => ({ ...f, handle: e.target.value }))}
              placeholder="@HoopsTakeTV"
            />
          </div>
          <div className="space-y-1">
            <Label>Accent Color</Label>
            <HslColorPicker
              label="Accent Color"
              value={creatorForm.accent_color ?? "hsl(0, 70%, 50%)"}
              onChange={(v) => setCreatorForm((f) => ({ ...f, accent_color: v ?? "hsl(0, 70%, 50%)" }))}
            />
          </div>
        </div>
      </FormDialog>

      {/* ── Delete dialogs ───────────────────── */}
      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={() => setDeleteId(null)}
        title="Delete Post"
        description="Remove this post from the feed?"
        onConfirm={() => deleteId && deleteMut.mutate(deleteId)}
        loading={deleteMut.isPending}
      />
      <ConfirmDialog
        open={!!creatorDeleteId}
        onOpenChange={() => setCreatorDeleteId(null)}
        title="Delete Creator"
        description="Remove this creator? Any YouTube posts attributed to them will remain but lose their creator link."
        onConfirm={() => creatorDeleteId && deleteCreatorMut.mutate(creatorDeleteId)}
        loading={deleteCreatorMut.isPending}
      />
    </div>
  );
}
