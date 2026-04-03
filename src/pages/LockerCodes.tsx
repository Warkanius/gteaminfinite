import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { KeyRound, Gift, Loader2 } from "lucide-react";
import { toast } from "sonner";

export default function LockerCodes() {
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [reward, setReward] = useState<{ type: string; description: string } | null>(null);

  async function handleRedeem() {
    if (!code.trim()) { toast.error("Enter a code"); return; }
    setLoading(true);
    setReward(null);
    try {
      const { data, error } = await supabase.functions.invoke("redeem-locker-code", {
        body: { code: code.trim().toUpperCase() },
      });
      if (error) throw error;
      if (data?.error) { toast.error(data.error); return; }
      setReward({ type: data.reward_type, description: data.reward_description });
      toast.success("Code redeemed!");
      setCode("");
    } catch (e: any) {
      toast.error(e.message ?? "Failed to redeem");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <h1 className="text-2xl font-bold flex items-center gap-2">
        <KeyRound className="h-6 w-6 text-primary" /> Locker Codes
      </h1>
      <Card>
        <CardHeader>
          <CardTitle>Enter a Code</CardTitle>
          <CardDescription>Redeem locker codes for coins, gems, cards, or packs.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input
              placeholder="e.g. GTEAM-2024"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === "Enter" && handleRedeem()}
              className="font-mono text-lg tracking-wider uppercase"
              maxLength={30}
            />
            <Button onClick={handleRedeem} disabled={loading || !code.trim()} className="gap-1.5 shrink-0">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
              Redeem
            </Button>
          </div>
        </CardContent>
      </Card>

      {reward && (
        <Card className="border-primary/50 bg-primary/5 animate-in fade-in-50 slide-in-from-bottom-4 duration-500">
          <CardContent className="flex items-center gap-4 py-6">
            <div className="h-14 w-14 rounded-full bg-primary/20 flex items-center justify-center">
              <Gift className="h-7 w-7 text-primary" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground uppercase tracking-wider">Reward Unlocked</p>
              <p className="text-xl font-bold">{reward.description}</p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
