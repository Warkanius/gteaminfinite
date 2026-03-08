import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dice5 } from "lucide-react";

interface DiceInputProps {
  onSubmit: (userDice: number, cpuDice: number) => void;
}

export function DiceInput({ onSubmit }: DiceInputProps) {
  const [userDice, setUserDice] = useState("");
  const [cpuDice, setCpuDice] = useState("");

  const userVal = parseInt(userDice);
  const cpuVal = parseInt(cpuDice);
  const valid =
    !isNaN(userVal) && userVal >= 1 && userVal <= 6 &&
    !isNaN(cpuVal) && cpuVal >= 1 && cpuVal <= 6;

  const handleSubmit = () => {
    if (valid) {
      onSubmit(userVal, cpuVal);
      setUserDice("");
      setCpuDice("");
    }
  };

  return (
    <div className="space-y-4 max-w-xs mx-auto">
      <p className="text-center text-sm text-muted-foreground">
        Roll your dice and enter the values (1-6)
      </p>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground uppercase">Your Roll</label>
          <div className="relative">
            <Dice5 className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="number"
              min={1}
              max={6}
              placeholder="1-6"
              value={userDice}
              onChange={(e) => setUserDice(e.target.value)}
              className="pl-9 text-center text-lg font-bold"
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            />
          </div>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground uppercase">CPU Roll</label>
          <div className="relative">
            <Dice5 className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="number"
              min={1}
              max={6}
              placeholder="1-6"
              value={cpuDice}
              onChange={(e) => setCpuDice(e.target.value)}
              className="pl-9 text-center text-lg font-bold"
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            />
          </div>
        </div>
      </div>
      <Button onClick={handleSubmit} disabled={!valid} className="w-full">
        Confirm Rolls
      </Button>
    </div>
  );
}
