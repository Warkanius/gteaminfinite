import { useLocation } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Construction } from "lucide-react";

export default function Placeholder() {
  const location = useLocation();
  const pageName = location.pathname.split("/").filter(Boolean).join(" / ") || "Home";

  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <Card className="border-border/50 bg-card max-w-md w-full text-center">
        <CardHeader>
          <Construction className="h-12 w-12 text-primary mx-auto mb-2" />
          <CardTitle className="font-display text-2xl capitalize">{pageName}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">This section is coming soon. Stay tuned!</p>
        </CardContent>
      </Card>
    </div>
  );
}
