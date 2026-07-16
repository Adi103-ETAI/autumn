// Autumn — Apps Integration Modal.
// Lets the user connect / disconnect third-party apps (Shopify, Lovable, Figma,
// Shortcut, Post Bridge, Canvas) to their canvas.
// Clones October Desktop's "Apps" integration picker (NOTES.md §6, Phase 4).

"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LayoutGrid, Check, Plug, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { THIRD_PARTY_APPS, useAutumnStore } from "@/lib/autumn/store";

// Static tint mapping for the icon square backgrounds.
// Tailwind needs literal class names — deriving them at runtime from the
// store's `color` string would let the JIT purge drop them, so we key by id.
const APP_ICON_TINT: Record<string, string> = {
  shopify: "bg-emerald-500/10 text-emerald-400",
  lovable: "bg-rose-500/10 text-rose-400",
  figma: "bg-fuchsia-500/10 text-fuchsia-400",
  shortcut: "bg-green-500/10 text-green-400",
  "post-bridge": "bg-violet-500/10 text-violet-400",
  canvas: "bg-sky-500/10 text-sky-400",
};

function iconTint(id: string, fallbackColor: string): string {
  return APP_ICON_TINT[id] ?? `bg-zinc-500/10 ${fallbackColor}`;
}

export function AppsIntegrationModal() {
  const open = useAutumnStore((s) => s.appsModalOpen);
  const setOpen = useAutumnStore((s) => s.setAppsModalOpen);
  const connectedApps = useAutumnStore((s) => s.connectedApps);
  const toggleApp = useAutumnStore((s) => s.toggleApp);

  const connectedCount = connectedApps.length;

  const handleConnect = (id: string, name: string) => {
    toggleApp(id);
    toast.success(`${name} connected.`, {
      description: "You can disconnect it anytime from this dialog.",
    });
  };

  const handleDisconnect = (id: string, name: string) => {
    toggleApp(id);
    toast.info(`${name} disconnected.`, {
      description: "You can reconnect anytime.",
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        showCloseButton={false}
        className={cn(
          "sm:max-w-2xl max-h-[85vh] overflow-y-auto autumn-scroll",
          "bg-zinc-950/90 border-border/50 backdrop-blur-xl rounded-2xl",
          "p-0 gap-0 shadow-2xl shadow-black/60",
        )}
      >
        {/* Header */}
        <DialogHeader className="flex-row items-start gap-3 p-5 pb-3 border-b border-border/50 text-left sm:flex-row sm:text-left">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-violet-500/10 text-violet-400">
            <LayoutGrid className="size-5" />
          </div>
          <div className="flex-1 min-w-0">
            <DialogTitle className="flex items-center gap-2 text-base font-semibold text-foreground">
              Apps
              {connectedCount > 0 && (
                <Badge
                  variant="outline"
                  className="text-[10px] font-medium border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                >
                  {connectedCount} connected
                </Badge>
              )}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground mt-1">
              Connect third-party apps to your canvas. Some are in early access.
            </DialogDescription>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="size-8 text-muted-foreground hover:text-foreground shrink-0"
            onClick={() => setOpen(false)}
            aria-label="Close"
          >
            <X className="size-4" />
          </Button>
        </DialogHeader>

        {/* Body */}
        <div className="p-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {THIRD_PARTY_APPS.map((app, i) => {
              const isConnected = connectedApps.includes(app.id);
              return (
                <AppCard
                  key={app.id}
                  id={app.id}
                  name={app.name}
                  description={app.description}
                  icon={app.icon}
                  color={app.color}
                  earlyAccess={app.earlyAccess}
                  isConnected={isConnected}
                  index={i}
                  onConnect={() => handleConnect(app.id, app.name)}
                  onDisconnect={() => handleDisconnect(app.id, app.name)}
                />
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <DialogFooter className="flex-col gap-3 p-5 pt-3 border-t border-border/50 sm:flex-row sm:justify-between sm:items-center">
          <button
            type="button"
            onClick={() =>
              toast("Coming soon", {
                description: "Manage your connected apps from your account.",
              })
            }
            className="text-xs text-muted-foreground hover:text-foreground transition-colors underline-offset-4 hover:underline text-left"
          >
            Manage connections
          </button>
          <Button
            onClick={() => setOpen(false)}
            className="gap-2 bg-gradient-to-r from-violet-500 to-orange-500 hover:from-violet-600 hover:to-orange-600 text-white shadow-lg shadow-violet-500/20 border-0"
          >
            <Check className="size-4" />
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface AppCardProps {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  earlyAccess?: boolean;
  isConnected: boolean;
  index: number;
  onConnect: () => void;
  onDisconnect: () => void;
}

function AppCard({
  id,
  name,
  description,
  icon,
  color,
  earlyAccess,
  isConnected,
  index,
  onConnect,
  onDisconnect,
}: AppCardProps) {
  const [connecting, setConnecting] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tint = iconTint(id, color);

  // Clear any pending OAuth timer if the card unmounts mid-flow (e.g. modal
  // closed while still showing "Connecting..."). Prevents stray toasts / toggles.
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, []);

  const handleConnect = () => {
    if (connecting) return;
    setConnecting(true);
    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = null;
      setConnecting(false);
      onConnect();
    }, 1400);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        delay: 0.04 + index * 0.05,
        duration: 0.25,
        ease: "easeOut",
      }}
      whileHover={{ y: -2, transition: { duration: 0.15 } }}
      className={cn(
        "flex h-full flex-col gap-3 rounded-xl border bg-muted/20 p-4 transition-colors",
        "hover:border-violet-500/40 hover:shadow-lg hover:shadow-black/30",
        isConnected
          ? "border-emerald-500/40 ring-1 ring-emerald-500/30"
          : "border-border/50",
      )}
    >
      {/* Top row: icon + name + early-access badge */}
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-xl text-xl leading-none",
            tint,
          )}
          aria-hidden
        >
          <span>{icon}</span>
        </div>
        <div className="flex-1 min-w-0 pt-0.5">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm font-medium text-foreground truncate">
              {name}
            </span>
            {earlyAccess && (
              <Badge
                variant="outline"
                className="text-[9px] font-semibold tracking-wide text-violet-400 border-violet-500/40"
              >
                EARLY ACCESS
              </Badge>
            )}
          </div>
        </div>
      </div>

      {/* Description (flex-1 keeps the action row aligned across cards) */}
      <p className="text-xs text-muted-foreground line-clamp-2 flex-1">
        {description}
      </p>

      {/* Action row */}
      <div className="flex items-center justify-end">
        {connecting ? (
          <Button
            variant="outline"
            size="sm"
            disabled
            className="gap-1.5 border-violet-500/40 text-violet-300 bg-violet-500/10 cursor-wait"
          >
            <Loader2 className="size-3.5 animate-spin" />
            Connecting...
          </Button>
        ) : isConnected ? (
          <Button
            variant="outline"
            size="sm"
            onClick={onDisconnect}
            className="gap-1.5 border-emerald-500/40 text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 hover:border-emerald-500/60"
          >
            <Check className="size-3.5" />
            Connected
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={handleConnect}
            className="gap-1.5 border-violet-500/40 text-violet-300 hover:bg-violet-500/10 hover:text-violet-200"
          >
            <Plug className="size-3.5" />
            Connect
          </Button>
        )}
      </div>
    </motion.div>
  );
}
