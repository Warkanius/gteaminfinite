import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Trophy, Target, Users, Swords } from "lucide-react";
import { useNavigate } from "react-router-dom";

const gameModes = [
  {
    title: "Domination",
    desc: "Battle through themed paths of 5v5 matchups for stacked rewards.",
    icon: Swords,
    url: "/domination",
    color: "text-gem-ruby",
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
  {
    title: "Play With Friends",
    desc: "Challenge your friends to a match. (Coming Soon)",
    icon: Users,
    url: null,
    color: "text-gem-diamond",
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
            className={
              mode.url
                ? "cursor-pointer border-border/50 bg-card hover:bg-accent/30 transition-all hover:scale-[1.02] group"
                : "border-border/50 bg-card opacity-60 cursor-not-allowed group"
            }
            onClick={() => mode.url && navigate(mode.url)}
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
