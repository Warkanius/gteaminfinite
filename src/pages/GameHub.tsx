import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dice5, Trophy, Target } from "lucide-react";
import { useNavigate } from "react-router-dom";

const gameModes = [
  {
    title: "Casual 5v5",
    desc: "A quick, classic 5-on-5 dice match against the CPU.",
    icon: Dice5,
    url: "/play/match",
    color: "text-gem-diamond",
  },
  {
    title: "The Runs",
    desc: "A grueling 3v3 Race to 21 gauntlet. Win streaks earn scaling rewards.",
    icon: Trophy,
    url: "/runs",
    color: "text-gem-amethyst",
  },
  {
    title: "Challenges",
    desc: "Complete specific scenarios to earn exclusive rewards.",
    icon: Target,
    url: "/challenges",
    color: "text-gem-emerald",
  },
];

export default function GameHub() {
  const navigate = useNavigate();

  return (
    <div className="space-y-8 pb-12">
      <div>
        <h1 className="font-display text-4xl font-bold tracking-wider">
          Game Modes
        </h1>
        <p className="text-muted-foreground mt-2 max-w-2xl">
          Choose how you want to hit the court. From casual matches to high-stakes gauntlets.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {gameModes.map((mode) => (
          <Card
            key={mode.title}
            className="cursor-pointer border-border/50 bg-card hover:bg-accent/30 transition-all hover:scale-[1.02] group"
            onClick={() => navigate(mode.url)}
          >
            <CardHeader className="pb-4">
              <mode.icon className={`h-12 w-12 ${mode.color} group-hover:scale-110 transition-transform`} />
            </CardHeader>
            <CardContent>
              <CardTitle className="font-display text-2xl mb-2">{mode.title}</CardTitle>
              <p className="text-muted-foreground">{mode.desc}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
