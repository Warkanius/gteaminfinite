import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Smartphone, Share, Plus, MoreVertical } from "lucide-react";

export default function Install() {
  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const isAndroid = /Android/.test(navigator.userAgent);

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <h1 className="text-2xl font-display font-bold tracking-wide">Install App</h1>
      <p className="text-sm text-muted-foreground">
        Add GTeam Infinite to your home screen for a full-screen, app-like experience.
      </p>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Smartphone className="h-5 w-5 text-primary" />
            {isIos ? "iPhone / iPad" : isAndroid ? "Android" : "Mobile"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {isIos ? (
            <ol className="list-decimal list-inside space-y-2">
              <li className="flex items-start gap-2">
                <Share className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
                <span>Tap the <strong>Share</strong> button in Safari</span>
              </li>
              <li className="flex items-start gap-2">
                <Plus className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
                <span>Scroll down and tap <strong>Add to Home Screen</strong></span>
              </li>
              <li>Tap <strong>Add</strong> to confirm</li>
            </ol>
          ) : (
            <ol className="list-decimal list-inside space-y-2">
              <li className="flex items-start gap-2">
                <MoreVertical className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
                <span>Tap the <strong>three-dot menu</strong> in Chrome</span>
              </li>
              <li>Tap <strong>Add to Home screen</strong> or <strong>Install app</strong></li>
              <li>Tap <strong>Install</strong> to confirm</li>
            </ol>
          )}
          <p className="text-xs text-muted-foreground pt-2">
            Once installed, open it from your home screen — it will launch in full-screen mode without the browser bar.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
