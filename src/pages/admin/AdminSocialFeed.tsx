import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DataTable, Column } from "@/components/admin/DataTable";
import { FormDialog } from "@/components/admin/FormDialog";
import { ConfirmDialog } from "@/components/admin/ConfirmDialog";
import { HslColorPicker } from "@/components/admin/HslColorPicker";
import { PostTemplatePreview } from "@/components/admin/PostTemplatePreview";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Pencil, Trash2, Upload, X, Users, Copy, Radio, MessageSquare, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";

/* ── Location accounts + templates ────────── */

interface LocationAccount {
  id: string;
  name: string;
  handle: string;
  avatar_url: string | null;
  accent_color: string | null;
  personality: string;
  location_type: "league" | "road" | "run" | string;
  road_name: string | null;
  run_id: string | null;
  is_active: boolean;
  created_at: string;
}

interface PostTemplate {
  id: string;
  personality: string;
  event_type: string;
  template_text: string;
  is_active: boolean;
  sort_order: number;
  created_at: string;
}

const EVENT_TYPES = ["game_result", "appearance", "evolution", "streak", "signing"];
const LOCATION_TYPES = ["league", "road", "run"];

const emptyAccount = (): Partial<LocationAccount> => ({
  name: "",
  handle: "",
  avatar_url: null,
  accent_color: "hsl(280, 70%, 50%)",
  personality: "hype",
  location_type: "league",
  road_name: null,
  run_id: null,
  is_active: true,
});

const emptyTemplate = (): Partial<PostTemplate> => ({
  personality: "hype",
  event_type: "game_result",
  template_text: "",
  is_active: true,
  sort_order: 0,
});

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
  scheduled_at: string | null;
  is_published: boolean;
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
  scheduled_at: null,
  is_published: true,
});

const emptyCreator = (): Partial<Creator> => ({
  name: "",
  handle: "",
  accent_color: "hsl(0, 70%, 50%)",
  avatar_url: null,
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
  const [creatorUploading, setCreatorUploading] = useState(false);
  const creatorFileRef = useRef<HTMLInputElement>(null);

  // Location account state
  const [accountDialogOpen, setAccountDialogOpen] = useState(false);
  const [accountForm, setAccountForm] = useState(emptyAccount());
  const [accountEditId, setAccountEditId] = useState<string | null>(null);
  const [accountDeleteId, setAccountDeleteId] = useState<string | null>(null);
  const [accountUploading, setAccountUploading] = useState(false);
  const accountFileRef = useRef<HTMLInputElement>(null);

  // Template state
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [templateForm, setTemplateForm] = useState(emptyTemplate());
  const [templateEditId, setTemplateEditId] = useState<string | null>(null);
  const [templateDeleteId, setTemplateDeleteId] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);

  const handleCreatorAvatarUpload = async (file: File) => {
    setCreatorUploading(true);
    try {
      const ext = file.name.split(".").pop();
      const path = `avatars/${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage.from("social-images").upload(path, file);
      if (error) throw error;
      const { data: urlData } = supabase.storage.from("social-images").getPublicUrl(path);
      setCreatorForm((f) => ({ ...f, avatar_url: urlData.publicUrl }));
      toast.success("Avatar uploaded");
    } catch (e: any) {
      toast.error(e.message ?? "Upload failed");
    } finally {
      setCreatorUploading(false);
    }
  };

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

  const { data: accounts = [] } = useQuery({
    queryKey: ["admin-location-accounts"],
    queryFn: async () => {
      const { data, error } = await supabase.from("location_accounts").select("*").order("name");
      if (error) throw error;
      return (data ?? []) as LocationAccount[];
    },
  });

  const { data: templates = [] } = useQuery({
    queryKey: ["admin-post-templates"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("location_post_templates")
        .select("*")
        .order("personality")
        .order("event_type")
        .order("sort_order");
      if (error) throw error;
      return (data ?? []) as PostTemplate[];
    },
  });

  const { data: runs = [] } = useQuery({
    queryKey: ["admin-runs-list"],
    queryFn: async () => {
      const { data } = await supabase.from("runs").select("id, name").order("name");
      return data ?? [];
    },
  });

  // Personalities pulled live from rule_config so adding one in Rules immediately appears here.
  const { data: personalities = ["hype", "analyst", "trash_talker", "historian", "meme"] } = useQuery({
    queryKey: ["personalities-enum"],
    queryFn: async () => {
      const { data } = await supabase.from("rule_config").select("value").eq("key", "personalities_enum").maybeSingle();
      const v = data?.value;
      if (Array.isArray(v) && v.every((x) => typeof x === "string")) return v as string[];
      return ["hype", "analyst", "trash_talker", "historian", "meme"];
    },
  });

  const playerMap = Object.fromEntries(players.map((p) => [p.id, p]));
  const creatorMap = Object.fromEntries(creators.map((c) => [c.id, c]));
  const runMap = Object.fromEntries(runs.map((r: any) => [r.id, r]));

  const handleAccountAvatarUpload = async (file: File) => {
    setAccountUploading(true);
    try {
      const ext = file.name.split(".").pop();
      const path = `accounts/${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage.from("social-images").upload(path, file);
      if (error) throw error;
      const { data: urlData } = supabase.storage.from("social-images").getPublicUrl(path);
      setAccountForm((f) => ({ ...f, avatar_url: urlData.publicUrl }));
      toast.success("Avatar uploaded");
    } catch (e: any) {
      toast.error(e.message ?? "Upload failed");
    } finally {
      setAccountUploading(false);
    }
  };

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
      const isScheduled = !!form.scheduled_at;
      const payload: any = {
        player_card_id: form.player_card_id || null,
        creator_id: form.creator_id || null,
        content: form.content,
        image_url: form.image_url || null,
        likes_count: form.likes_count ?? 0,
        comments_count: form.comments_count ?? 0,
        post_type: form.post_type ?? "tweet",
        scheduled_at: form.scheduled_at || null,
        is_published: isScheduled ? false : true,
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
        avatar_url: creatorForm.avatar_url ?? null,
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

  /* ── Account mutations ───────────────────── */

  const saveAccountMut = useMutation({
    mutationFn: async () => {
      const payload: any = {
        name: accountForm.name?.trim() ?? "",
        handle: accountForm.handle?.trim().replace(/^@/, "") ?? "",
        avatar_url: accountForm.avatar_url ?? null,
        accent_color: accountForm.accent_color ?? "hsl(280, 70%, 50%)",
        personality: accountForm.personality ?? "hype",
        location_type: accountForm.location_type ?? "league",
        road_name: accountForm.location_type === "road" ? (accountForm.road_name ?? null) : null,
        run_id: accountForm.location_type === "run" ? (accountForm.run_id ?? null) : null,
        is_active: accountForm.is_active ?? true,
      };
      if (!payload.name || !payload.handle) throw new Error("Name and handle are required");
      if (payload.location_type === "road" && !payload.road_name) throw new Error("Road name is required");
      if (payload.location_type === "run" && !payload.run_id) throw new Error("Pick a run");
      if (accountEditId) {
        const { error } = await supabase.from("location_accounts").update(payload).eq("id", accountEditId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("location_accounts").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-location-accounts"] });
      qc.invalidateQueries({ queryKey: ["admin-rules-location-accounts"] });
      setAccountDialogOpen(false);
      toast.success(accountEditId ? "Account updated" : "Account created");
    },
    onError: (e: any) => toast.error(e.message ?? "Save failed"),
  });

  const deleteAccountMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("location_accounts").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-location-accounts"] });
      qc.invalidateQueries({ queryKey: ["admin-rules-location-accounts"] });
      setAccountDeleteId(null);
      toast.success("Account deleted");
    },
    onError: (e) => toast.error(e.message),
  });

  const toggleAccountActiveMut = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase.from("location_accounts").update({ is_active }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-location-accounts"] }),
    onError: (e) => toast.error(e.message),
  });

  /* ── Template mutations ──────────────────── */

  const saveTemplateMut = useMutation({
    mutationFn: async () => {
      const payload: any = {
        personality: templateForm.personality ?? "hype",
        event_type: templateForm.event_type ?? "game_result",
        template_text: templateForm.template_text?.trim() ?? "",
        sort_order: templateForm.sort_order ?? 0,
        is_active: templateForm.is_active ?? true,
      };
      if (!payload.template_text) throw new Error("Template text is required");
      if (templateEditId) {
        const { error } = await supabase.from("location_post_templates").update(payload).eq("id", templateEditId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("location_post_templates").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-post-templates"] });
      setTemplateDialogOpen(false);
      toast.success(templateEditId ? "Template updated" : "Template created");
    },
    onError: (e: any) => toast.error(e.message ?? "Save failed"),
  });

  const deleteTemplateMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("location_post_templates").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-post-templates"] });
      setTemplateDeleteId(null);
      toast.success("Template deleted");
    },
    onError: (e) => toast.error(e.message),
  });

  const seedDefaults = async () => {
    setSeeding(true);
    try {
      const seeds: { personality: string; event_type: string; template_text: string }[] = [];
      const SEED_BY_PERSONALITY: Record<string, Record<string, string[]>> = {
        hype: {
          game_result: [
            "🚨 {player} GOES OFF for {stat_line} in a {score} W over {opponent}!! 🔥🔥",
            "{score} FINAL — {player} cooked the {opponent} ({stat_line}). Unreal.",
          ],
          appearance: [
            "👀 LOOK who just pulled up — {tier} {player} in the building!!",
            "Yo {player} ({tier}) just stepped on the court 😤",
          ],
          evolution: [
            "📈 {player} just EVOLVED. Different beast now.",
            "{player} unlocked a new tier. We are NOT safe.",
          ],
          streak: [
            "🔥 {player} on a {streak}-game heater. STOP HIM.",
            "{streak} W's in a row for {player}. Locked in.",
          ],
          signing: [
            "🚨 BREAKING — {tier} {player} just hit the league!! 📝",
            "WELCOME {player} ({tier}) to the show 🎉",
          ],
        },
        analyst: {
          game_result: [
            "Box score: {player} — {stat_line}. Final {score} vs {opponent}.",
            "{player} put up {stat_line}, leading the {score} win over {opponent}.",
          ],
          appearance: [
            "Notable check-in: {tier} {player} on the floor.",
            "Tier alert — {player} ({tier}) is in the lineup.",
          ],
          evolution: [
            "Progression update: {player} reached a new tier today.",
            "{player} evolved. Worth tracking how the new badges play out.",
          ],
          streak: [
            "{player} is now on a {streak}-game win streak.",
            "Sample size growing: {streak} straight Ws for {player}.",
          ],
          signing: [
            "Roster move: {tier} {player} added to the league pool.",
            "New asset: {player} ({tier}) enters circulation.",
          ],
        },
        trash_talker: {
          game_result: [
            "{opponent} got COOKED. {score}. {player} dropped {stat_line}. Pack it up.",
            "Lol @ {opponent}. {player} ({stat_line}) said sit down. {score}.",
          ],
          appearance: [
            "Oh you brought {player} ({tier})? Y'all really tried it 😂",
            "{tier} {player} pulled up. Run home.",
          ],
          evolution: [
            "{player} evolved. Like he wasn't already too much. Ridiculous.",
            "Bro {player} got an upgrade?? Unfair league.",
          ],
          streak: [
            "{streak} in a row?? Somebody PLEASE beat {player}. This is embarrassing.",
            "{player} on {streak} straight. The competition is washed.",
          ],
          signing: [
            "Y'all REALLY signed {player} ({tier})?? Pay attention league.",
            "{tier} {player} in the building. Other GMs in shambles.",
          ],
        },
        historian: {
          game_result: [
            "On this night: {player} — {stat_line} — leads a {score} victory over {opponent}.",
            "Filed away: {score} W, {player} with {stat_line}. One for the books.",
          ],
          appearance: [
            "Sighting: {tier} {player} returns to the hardwood.",
            "{player} ({tier}) makes another appearance — every showing matters.",
          ],
          evolution: [
            "{player} reaches a new chapter. Evolution complete.",
            "Today {player} crossed a tier threshold. Noted.",
          ],
          streak: [
            "{player} extends the run to {streak} straight wins.",
            "Streak watch: {player} now at {streak} consecutive Ws.",
          ],
          signing: [
            "Welcomed today: {tier} {player}. A new name on the ledger.",
            "League roster grows — {player} ({tier}) signs in.",
          ],
        },
        meme: {
          game_result: [
            "{player} dropping {stat_line} is criminal. {score}. {opponent} = ☠️",
            "POV: you played {player}. {stat_line}. {score}. ggwp 💀",
          ],
          appearance: [
            "no bc why is {tier} {player} HERE 😭",
            "{player} ({tier}) showed up I'm crying 💀",
          ],
          evolution: [
            "{player} hit evolve and now he's built different fr",
            "they really upgraded {player} 😭 nerf when",
          ],
          streak: [
            "{player} on {streak} W's. Touch grass champ.",
            "{streak} straight. {player} is in his bag fr fr.",
          ],
          signing: [
            "{tier} {player} just signed I— 🧎",
            "new card alert 🚨 {player} ({tier}) welcome to the chaos",
          ],
        },
      };

      for (const personality of personalities) {
        const templatesForP = SEED_BY_PERSONALITY[personality];
        if (!templatesForP) continue;
        for (const event_type of EVENT_TYPES) {
          for (const text of (templatesForP[event_type] ?? [])) {
            seeds.push({ personality, event_type, template_text: text });
          }
        }
      }

      const { data: existing } = await supabase
        .from("location_post_templates")
        .select("personality,event_type,template_text");
      const seen = new Set((existing ?? []).map((r: any) => `${r.personality}|${r.event_type}|${r.template_text}`));
      const toInsert = seeds.filter((s) => !seen.has(`${s.personality}|${s.event_type}|${s.template_text}`));

      if (toInsert.length === 0) {
        toast.info("All default templates already exist");
        return;
      }
      const { error } = await supabase.from("location_post_templates").insert(toInsert);
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ["admin-post-templates"] });
      toast.success(`Seeded ${toInsert.length} templates`);
    } catch (e: any) {
      toast.error(e.message ?? "Seed failed");
    } finally {
      setSeeding(false);
    }
  };

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
      render: (r) => {
        if (!r.is_published && r.scheduled_at) {
          return <span className="text-yellow-500">📅 {new Date(r.scheduled_at).toLocaleString()}</span>;
        }
        return formatDistanceToNow(new Date(r.posted_at), { addSuffix: true });
      },
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
                <Button size="icon" variant="ghost" title="Duplicate" onClick={() => { setForm({ ...row, id: undefined as any, content: `${row.content}` }); setEditId(null); setDialogOpen(true); }}>
                  <Copy className="h-4 w-4" />
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
                  <Button size="icon" variant="ghost" title="Duplicate" onClick={() => { setCreatorForm({ ...row, name: `${row.name} (Copy)`, handle: `${row.handle}_copy` }); setCreatorEditId(null); setCreatorDialogOpen(true); }}>
                    <Copy className="h-4 w-4" />
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

          {/* Attribution — Player */}
          <div className="space-y-1">
            <Label>Player (optional)</Label>
            <Select
              value={form.player_card_id ?? "none"}
              onValueChange={(v) => setForm((f) => ({ ...f, player_card_id: v === "none" ? null : v, creator_id: v === "none" ? f.creator_id : null }))}
            >
              <SelectTrigger><SelectValue placeholder="League post" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— None —</SelectItem>
                {players.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.social_handle ?? p.name} — {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Attribution — Creator */}
          <div className="space-y-1">
            <Label>Creator (optional)</Label>
            <Select
              value={form.creator_id ?? "none"}
              onValueChange={(v) => setForm((f) => ({ ...f, creator_id: v === "none" ? null : v, player_card_id: v === "none" ? f.player_card_id : null }))}
            >
              <SelectTrigger><SelectValue placeholder="No creator" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— None —</SelectItem>
                {creators.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.handle} — {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

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

          {/* Schedule */}
          <div className="space-y-1">
            <Label>Schedule (optional)</Label>
            <Input
              type="datetime-local"
              value={form.scheduled_at ? new Date(form.scheduled_at).toISOString().slice(0, 16) : ""}
              onChange={(e) => setForm((f) => ({ ...f, scheduled_at: e.target.value ? new Date(e.target.value).toISOString() : null }))}
            />
            <p className="text-xs text-muted-foreground">
              {form.scheduled_at ? "Post will be hidden until this time, then auto-published." : "Leave empty to publish immediately."}
            </p>
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
        className="max-w-md max-h-[85vh] flex flex-col overflow-hidden"
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
          {/* Avatar upload */}
          <div className="space-y-2">
            <Label>Profile Picture</Label>
            <div className="flex items-center gap-3">
              {creatorForm.avatar_url ? (
                <div className="relative">
                  <img src={creatorForm.avatar_url} alt="Avatar" className="h-14 w-14 rounded-full object-cover border border-border" />
                  <Button
                    size="icon"
                    variant="destructive"
                    className="absolute -top-1 -right-1 h-5 w-5"
                    onClick={() => setCreatorForm((f) => ({ ...f, avatar_url: null }))}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              ) : (
                <div
                  className="h-14 w-14 rounded-full border-2 border-dashed border-muted-foreground/25 flex items-center justify-center cursor-pointer hover:border-primary/50 transition-colors"
                  onClick={() => creatorFileRef.current?.click()}
                >
                  {creatorUploading ? (
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                  ) : (
                    <Upload className="h-5 w-5 text-muted-foreground" />
                  )}
                </div>
              )}
              <Button variant="outline" size="sm" onClick={() => creatorFileRef.current?.click()} disabled={creatorUploading}>
                {creatorUploading ? "Uploading…" : "Upload"}
              </Button>
            </div>
            <input
              ref={creatorFileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleCreatorAvatarUpload(file);
                e.target.value = "";
              }}
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
