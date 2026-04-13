import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dice5 } from "lucide-react";

interface DiceInputProps {
  diceCount: number; // 1-6
  onSubmit: (userDice: number[], cpuDice: number[]) => void;
}

export function DiceInput({ diceCount, onSubmit }: DiceInputProps) {
  const [userDice, setUserDice] = useState<string[]>(Array(diceCount).fill(""));
  const [cpuDice, setCpuDice] = useState<string[]>(Array(diceCount).fill(""));

  const isValid = (arr: string[]) =>
    arr.every((v) => { const n = parseInt(v); return !isNaN(n) && n >= 1 && n <= 6; });

  const valid = isValid(userDice) && isValid(cpuDice);

  const handleSubmit = () => {
    if (valid) {
      onSubmit(userDice.map(Number), cpuDice.map(Number));
      setUserDice(Array(diceCount).fill(""));
      setCpuDice(Array(diceCount).fill(""));
    }
  };

  // Reset when diceCount changes
  if (userDice.length !== diceCount) {
    setUserDice(Array(diceCount).fill(""));
    setCpuDice(Array(diceCount).fill(""));
  }

  const renderInputs = (values: string[], setter: (v: string[]) => void, label: string) => (
    <div className="space-y-1">
      <label className="text-xs text-muted-foreground uppercase">{label}</label>
      <div className="flex flex-wrap gap-1.5">
        {values.map((v, i) => (
          <div key={i} className="relative">
            <Dice5 className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              type="number"
              min={1}
              max={6}
              placeholder="1-6"
              value={v}
              onChange={(e) => {
                const next = [...values];
                next[i] = e.target.value;
                setter(next);
              }}
              className="pl-7 text-center text-base font-bold w-16"
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            />
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="space-y-4 max-w-sm mx-auto">
      <p className="text-center text-sm text-muted-foreground">
        Roll {diceCount === 1 ? "one die" : `${diceCount} dice`} and enter the values (1-6)
      </p>
      <div className="grid grid-cols-2 gap-4">
        {renderInputs(userDice, setUserDice, "Your Roll")}
        {renderInputs(cpuDice, setCpuDice, "CPU Roll")}
      </div>
      <Button onClick={handleSubmit} disabled={!valid} className="w-full">
        Confirm Rolls
      </Button>
    </div>
  );
}
