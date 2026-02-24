import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DataTable, Column } from "@/components/admin/DataTable";
import { FormDialog } from "@/components/admin/FormDialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Pencil, Coins, Gem } from "lucide-react";
import { toast } from "sonner";
import type { Tables } from "@/integrations/supabase/types";

type Profile = Tables<"profiles">;

export default function AdminCurrencies() {
  const qc = useQueryClient();
  const [editProfile, setEditProfile] = useState<Profile | null>(null);
  const [editCoins, setEditCoins] = useState(0);
  const [editGems, setEditGems] = useState(0);

  // Award form
  const [awardUser, setAwardUser] = useState("");
  const [awardCoins, setAwardCoins] = useState(0);
  const [awardGems, setAwardGems] = useState(0);
  const [awardDialog, setAwardDialog] = useState(false);

  const { data: profiles = [], isLoading } = useQuery({
    queryKey: ["admin-profiles"],
    queryFn: async () => { const { data, error } = await supabase.from("profiles").select("*").order("display_name"); if (error) throw error; return data; },
  });

  const totalCoins = profiles.reduce((s, p) => s + p.coins, 0);
  const totalGems = profiles.reduce((s, p) => s + p.gems, 0);

  const updateMut = useMutation({
    mutationFn: async () => {
      if (!editProfile) return;
      const { error } = await supabase.from("profiles").update({ coins: editCoins, gems: editGems }).eq("id", editProfile.id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-profiles"] }); setEditProfile(null); toast.success("Updated"); },
    onError: (e) => toast.error(e.message),
  });

  const awardMut = useMutation({
    mutationFn: async () => {
      const profile = profiles.find((p) => p.id === awardUser);
      if (!profile) throw new Error("Select a user");
      const { error } = await supabase.from("profiles").update({ coins: profile.coins + awardCoins, gems: profile.gems + awardGems }).eq("id", profile.id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-profiles"] }); setAwardDialog(false); setAwardCoins(0); setAwardGems(0); toast.success("Awarded"); },
    onError: (e) => toast.error(e.message),
  });

  const columns: Column<Profile>[] = [
    { key: "display_name", label: "Player", sortable: true, render: (r) => r.display_name ?? "—" },
    { key: "coins", label: "Coins", sortable: true },
    { key: "gems", label: "Gems", sortable: true },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Currencies Manager</h1>

      <div className="grid grid-cols-2 gap-4">
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground flex items-center gap-2"><Coins className="h-4 w-4" /> Total Coins</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold">{totalCoins.toLocaleString()}</p></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground flex items-center gap-2"><Gem className="h-4 w-4" /> Total Gems</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold">{totalGems.toLocaleString()}</p></CardContent></Card>
      </div>

      <DataTable data={profiles} columns={columns} isLoading={isLoading} searchKeys={["display_name"]} searchPlaceholder="Search players…"
        onAdd={() => { setAwardUser(""); setAwardCoins(0); setAwardGems(0); setAwardDialog(true); }} addLabel="Award Currency"
        actions={(r) => (
          <Button size="icon" variant="ghost" onClick={() => { setEditProfile(r); setEditCoins(r.coins); setEditGems(r.gems); }}>
            <Pencil className="h-4 w-4" />
          </Button>
        )}
      />

      {/* Edit balance */}
      <FormDialog open={!!editProfile} onOpenChange={(o) => !o && setEditProfile(null)} title={`Edit Balance: ${editProfile?.display_name ?? ""}`} onSave={() => updateMut.mutate()} saving={updateMut.isPending}>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1"><Label>Coins</Label><Input type="number" value={editCoins} onChange={(e) => setEditCoins(Number(e.target.value))} /></div>
          <div className="space-y-1"><Label>Gems</Label><Input type="number" value={editGems} onChange={(e) => setEditGems(Number(e.target.value))} /></div>
        </div>
      </FormDialog>

      {/* Award currency */}
      <FormDialog open={awardDialog} onOpenChange={setAwardDialog} title="Award Currency" onSave={() => awardMut.mutate()} saving={awardMut.isPending}>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label>Player</Label>
            <Select value={awardUser} onValueChange={setAwardUser}>
              <SelectTrigger><SelectValue placeholder="Select player" /></SelectTrigger>
              <SelectContent>{profiles.map((p) => <SelectItem key={p.id} value={p.id}>{p.display_name ?? p.user_id}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1"><Label>Add Coins</Label><Input type="number" value={awardCoins} onChange={(e) => setAwardCoins(Number(e.target.value))} /></div>
            <div className="space-y-1"><Label>Add Gems</Label><Input type="number" value={awardGems} onChange={(e) => setAwardGems(Number(e.target.value))} /></div>
          </div>
        </div>
      </FormDialog>
    </div>
  );
}
