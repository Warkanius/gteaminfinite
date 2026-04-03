import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Gem, CheckCircle, Clock, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";

export default function GemTasks() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ["gem-tasks"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("gem_tasks")
        .select("*")
        .eq("is_active", true)
        .order("category")
        .order("gem_reward", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: completions = [] } = useQuery({
    queryKey: ["gem-task-completions", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("gem_task_completions")
        .select("*")
        .eq("user_id", user!.id)
        .order("completed_at", { ascending: false });
      return data ?? [];
    },
    enabled: !!user,
  });

  const { data: profile } = useQuery({
    queryKey: ["profile-currency", user?.id],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("gems").eq("user_id", user!.id).single();
      return data;
    },
    enabled: !!user,
  });

  const completeMut = useMutation({
    mutationFn: async (taskId: string) => {
      const { data, error } = await supabase.functions.invoke("complete-gem-task", {
        body: { task_id: taskId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["gem-task-completions"] });
      qc.invalidateQueries({ queryKey: ["profile-currency"] });
      toast.success(`+${data.gems_earned} 💎 Gems earned!`);
    },
    onError: (e) => toast.error(e.message),
  });

  function getTaskStatus(taskId: string, cooldownHours: number) {
    const taskCompletions = completions.filter((c: any) => c.gem_task_id === taskId);
    if (taskCompletions.length === 0) return { available: true, lastCompleted: null, timeRemaining: null };

    const latest = new Date(taskCompletions[0].completed_at);
    const cooldownMs = cooldownHours * 60 * 60 * 1000;
    const timeSince = Date.now() - latest.getTime();

    if (timeSince >= cooldownMs) return { available: true, lastCompleted: latest, timeRemaining: null };

    const remaining = cooldownMs - timeSince;
    const hours = Math.floor(remaining / 3600000);
    const mins = Math.floor((remaining % 3600000) / 60000);
    return { available: false, lastCompleted: latest, timeRemaining: `${hours}h ${mins}m` };
  }

  const categories = [...new Set(tasks.map((t: any) => t.category))];

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Gem className="h-6 w-6 text-gem-diamond" /> Earn Gems
        </h1>
        <div className="flex items-center gap-1.5">
          <span className="text-gem-diamond font-bold">💎</span>
          <span className="font-mono font-bold text-lg">{profile?.gems ?? 0}</span>
        </div>
      </div>

      <p className="text-muted-foreground text-sm">
        Complete real-world tasks to earn gems. Each task has a cooldown before it can be completed again.
      </p>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
      ) : tasks.length === 0 ? (
        <Card><CardContent className="py-8 text-center text-muted-foreground">No tasks available yet. Check back soon!</CardContent></Card>
      ) : (
        categories.map((cat) => (
          <div key={cat} className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
              <Sparkles className="h-3.5 w-3.5" />
              {cat} Tasks
            </h2>
            {tasks.filter((t: any) => t.category === cat).map((task: any) => {
              const status = getTaskStatus(task.id, task.cooldown_hours);
              const cooldownPct = status.timeRemaining
                ? 100 - ((Date.now() - (status.lastCompleted?.getTime() ?? 0)) / (task.cooldown_hours * 3600000) * 100)
                : 0;

              return (
                <Card key={task.id} className={`transition-colors ${status.available ? "border-primary/30 hover:border-primary/50" : "opacity-70"}`}>
                  <CardContent className="flex items-center gap-4 py-4">
                    <div className="h-10 w-10 rounded-full flex items-center justify-center shrink-0" style={{ background: status.available ? "hsl(var(--primary) / 0.15)" : "hsl(var(--muted))" }}>
                      {status.available ? (
                        <Gem className="h-5 w-5 text-gem-diamond" />
                      ) : (
                        <Clock className="h-5 w-5 text-muted-foreground" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="font-medium text-sm">{task.title}</h3>
                        <Badge variant="secondary" className="text-xs gap-1">
                          <Gem className="h-3 w-3" /> +{task.gem_reward}
                        </Badge>
                      </div>
                      {task.description && <p className="text-xs text-muted-foreground mt-0.5">{task.description}</p>}
                      {status.timeRemaining && (
                        <div className="flex items-center gap-2 mt-1.5">
                          <Progress value={Math.max(0, cooldownPct)} className="h-1 flex-1 max-w-32" />
                          <span className="text-[10px] text-muted-foreground">{status.timeRemaining}</span>
                        </div>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant={status.available ? "default" : "outline"}
                      disabled={!status.available || completeMut.isPending}
                      onClick={() => completeMut.mutate(task.id)}
                      className="shrink-0 gap-1"
                    >
                      {completeMut.isPending ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : status.available ? (
                        <CheckCircle className="h-3.5 w-3.5" />
                      ) : (
                        <Clock className="h-3.5 w-3.5" />
                      )}
                      {status.available ? "Complete" : "Cooldown"}
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        ))
      )}
    </div>
  );
}
