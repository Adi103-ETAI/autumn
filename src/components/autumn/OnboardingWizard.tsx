// Autumn — Onboarding Wizard.
// A full-screen 4-step onboarding flow that clones October Desktop's wizard
// (NOTES.md §2, images 01–08). Two-column layout: question + option cards on
// the left, a live preview pane on the right.
//
// Steps:
//   0 — Role          (single select)
//   1 — Project type  (single select)
//   2 — AI tools      (multi-select; "None yet" is exclusive)
//   3 — Start mode    (single select)
//
// Visibility: renders only while `appStage === "onboarding"`.

"use client";

import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  Briefcase,
  Palette,
  Code2,
  Rocket,
  HelpCircle,
  Smartphone,
  Globe,
  Gamepad2,
  Sparkles,
  MousePointer2,
  Github,
  MessageSquare,
  Bot,
  Wand2,
  CircleSlash,
  LayoutGrid,
  LayoutTemplate,
  FolderOpen,
  Check,
  ArrowLeft,
  ArrowRight,
  type LucideIcon,
} from "lucide-react";
import { AutumnLogo } from "@/components/autumn/AutumnLogo";
import {
  useAutumnStore,
  type OnboardingData,
  type OnboardingProjectType,
  type OnboardingRole,
  type OnboardingStartMode,
} from "@/lib/autumn/store";

// ---- Step config -----------------------------------------------------------

interface OptionDef<V extends string> {
  value: V;
  label: string;
  icon: LucideIcon;
}

const ROLE_OPTIONS: readonly OptionDef<OnboardingRole>[] = [
  { value: "pm", label: "Product manager", icon: Briefcase },
  { value: "designer", label: "Designer", icon: Palette },
  { value: "developer", label: "Developer", icon: Code2 },
  { value: "founder", label: "Founder", icon: Rocket },
  { value: "other", label: "Something else", icon: HelpCircle },
];

const PROJECT_OPTIONS: readonly OptionDef<OnboardingProjectType>[] = [
  { value: "mobile", label: "Mobile app", icon: Smartphone },
  { value: "website", label: "Website", icon: Globe },
  { value: "game", label: "Game", icon: Gamepad2 },
  { value: "unsure", label: "Not sure yet", icon: Sparkles },
];

const AI_TOOL_OPTIONS: readonly OptionDef<string>[] = [
  { value: "cursor", label: "Cursor", icon: MousePointer2 },
  { value: "copilot", label: "GitHub Copilot", icon: Github },
  { value: "chatgpt", label: "ChatGPT", icon: MessageSquare },
  { value: "claude", label: "Claude", icon: Bot },
  { value: "lovable", label: "Lovable / v0 / Bolt", icon: Wand2 },
  { value: "none", label: "None yet", icon: CircleSlash },
];

const START_OPTIONS: readonly OptionDef<OnboardingStartMode>[] = [
  { value: "blank", label: "Blank canvas", icon: LayoutGrid },
  { value: "template", label: "From a template", icon: LayoutTemplate },
  { value: "folder", label: "Open a folder", icon: FolderOpen },
];

const STEPS = [
  { title: "What's your role?", subtitle: "Helps us tailor Autumn to how you work." },
  { title: "What are you building?", subtitle: "Pick any that apply." },
  { title: "Which AI tools do you use today?", subtitle: "Pick any that apply." },
  { title: "How do you want to start?", subtitle: "You can change this anytime." },
] as const;

// ---- Friendly label maps (for the preview pane) ----------------------------

const ROLE_LABEL: Record<OnboardingRole, string> = {
  pm: "Product manager",
  designer: "Designer",
  developer: "Developer",
  founder: "Founder",
  other: "Something else",
};

const PROJECT_LABEL: Record<OnboardingProjectType, string> = {
  mobile: "Mobile app",
  website: "Website",
  game: "Game",
  unsure: "Not sure yet",
};

const START_LABEL: Record<OnboardingStartMode, string> = {
  blank: "Blank canvas",
  template: "From a template",
  folder: "Open a folder",
};

const AI_TOOL_LABEL: Record<string, string> = {
  cursor: "Cursor",
  copilot: "GitHub Copilot",
  chatgpt: "ChatGPT",
  claude: "Claude",
  lovable: "Lovable / v0 / Bolt",
  none: "None yet",
};

// ---- Option card -----------------------------------------------------------

function OptionCard({
  icon: Icon,
  label,
  selected,
  multi,
  fullWidth,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  selected: boolean;
  multi?: boolean;
  fullWidth?: boolean;
  onClick: () => void;
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileHover={{ scale: 1.01 }}
      whileTap={{ scale: 0.99 }}
      aria-pressed={selected}
      className={cn(
        "group relative flex items-center gap-3 rounded-xl border p-4 text-left transition-all duration-200",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40",
        fullWidth && "sm:col-span-2",
        selected
          ? "border-violet-500/50 bg-violet-500/5 ring-1 ring-violet-500/20"
          : "border-border/50 bg-card/40 hover:bg-accent/40 hover:border-border",
      )}
    >
      <span
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-lg transition-colors",
          selected
            ? "bg-violet-500/15 text-violet-300"
            : "bg-muted/50 text-muted-foreground group-hover:text-foreground",
        )}
      >
        <Icon className="size-5" />
      </span>
      <span
        className={cn(
          "flex-1 text-sm font-medium",
          selected ? "text-foreground" : "text-foreground/80",
        )}
      >
        {label}
      </span>

      {/* Selection indicator */}
      {multi ? (
        <span
          className={cn(
            "flex size-5 shrink-0 items-center justify-center rounded-md border transition-all",
            selected
              ? "border-violet-600 bg-violet-600 text-white"
              : "border-border/60 bg-transparent",
          )}
        >
          {selected && (
            <motion.span
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 500, damping: 25 }}
            >
              <Check className="size-3.5" strokeWidth={3} />
            </motion.span>
          )}
        </span>
      ) : (
        <AnimatePresence>
          {selected && (
            <motion.span
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0, opacity: 0 }}
              transition={{ type: "spring", stiffness: 500, damping: 25 }}
              className="flex size-5 shrink-0 items-center justify-center rounded-full bg-violet-600 text-white"
            >
              <Check className="size-3.5" strokeWidth={3} />
            </motion.span>
          )}
        </AnimatePresence>
      )}
    </motion.button>
  );
}

// ---- Preview pane ----------------------------------------------------------

function PreviewContent({ step, data }: { step: number; data: OnboardingData }) {
  if (step === 0) {
    return (
      <div>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
          Your role
        </div>
        {data.role ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-500/40 bg-violet-500/15 px-3 py-1 text-xs font-medium text-violet-200">
            <Briefcase className="size-3" />
            {ROLE_LABEL[data.role]}
          </span>
        ) : (
          <p className="text-xs italic text-muted-foreground">
            Pick a role to see it here…
          </p>
        )}
      </div>
    );
  }

  if (step === 1) {
    const pt = data.projectType;
    const Icon =
      pt === "mobile"
        ? Smartphone
        : pt === "website"
          ? Globe
          : pt === "game"
            ? Gamepad2
            : Sparkles;
    return (
      <div>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
          Building
        </div>
        {pt ? (
          <div className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-md bg-violet-500/15 text-violet-300">
              <Icon className="size-4" />
            </span>
            <span className="text-sm font-medium text-foreground">
              {PROJECT_LABEL[pt]}
            </span>
          </div>
        ) : (
          <p className="text-xs italic text-muted-foreground">
            Pick a project type…
          </p>
        )}
        {/* faux mockup lines */}
        <div className="mt-3 space-y-1.5">
          <div className="h-1.5 w-3/4 rounded-full bg-gradient-to-r from-violet-500/40 to-transparent" />
          <div className="h-1.5 w-1/2 rounded-full bg-muted/50" />
          <div className="h-1.5 w-2/3 rounded-full bg-muted/40" />
        </div>
      </div>
    );
  }

  if (step === 2) {
    return (
      <div>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
          Your stack
        </div>
        {data.aiTools.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {data.aiTools.map((t) => (
              <span
                key={t}
                className="inline-flex items-center rounded-md border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-[11px] font-medium text-violet-100"
              >
                {AI_TOOL_LABEL[t] ?? t}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-xs italic text-muted-foreground">
            Pick the tools you use…
          </p>
        )}
        <p className="mt-3 text-[10px] text-muted-foreground">
          Autumn plays nice with your stack.
        </p>
      </div>
    );
  }

  // step === 3
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
        Start mode
      </div>
      {data.startMode ? (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/15 px-3 py-1 text-xs font-medium text-emerald-200">
          <Check className="size-3" strokeWidth={3} />
          {START_LABEL[data.startMode]}
        </span>
      ) : (
        <p className="text-xs italic text-muted-foreground">
          Choose how to begin…
        </p>
      )}
    </div>
  );
}

function PreviewPane({ step, data }: { step: number; data: OnboardingData }) {
  return (
    <Card className="relative overflow-hidden rounded-2xl border border-white/5 bg-[#1a202c] p-5 shadow-lg shadow-black/30">
      {/* gradient top hairline */}
      <div className="absolute inset-x-0 top-0 h-px bg-white/5" />

      {/* Header: logo + wordmark + tagline */}
      <div className="mb-5 flex items-center gap-3">
        <AutumnLogo size={40} glow />
        <div>
          <div className="text-base font-semibold leading-tight text-foreground">
            Autumn
          </div>
          <div className="text-[11px] text-muted-foreground">
            Built for whoever ships.
          </div>
        </div>
      </div>

      {/* Live preview area */}
      <div className="mb-4 min-h-[136px] rounded-xl border border-border/40 bg-background/40 p-4">
        <AnimatePresence mode="wait">
          <motion.div
            key={`${step}-${data.role ?? ""}-${data.projectType ?? ""}-${data.aiTools.join(",")}-${data.startMode ?? ""}`}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
          >
            <PreviewContent step={step} data={data} />
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Footer: live dot + workspace + framework */}
      <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <span className="relative flex size-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
            <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
          </span>
          <span className="font-medium text-emerald-300/90">Live</span>
        </div>
        <span className="truncate">Untitled workspace</span>
        <span className="rounded-md border border-border/50 bg-muted/40 px-1.5 py-0.5 text-[10px] font-medium text-foreground/70">
          Next.js
        </span>
      </div>
    </Card>
  );
}

// ---- Options renderer ------------------------------------------------------

function StepOptions({
  step,
  data,
  setField,
  toggleTool,
}: {
  step: number;
  data: OnboardingData;
  setField: <K extends keyof OnboardingData>(key: K, value: OnboardingData[K]) => void;
  toggleTool: (tool: string) => void;
}) {
  if (step === 0) {
    return (
      <>
        {ROLE_OPTIONS.map((opt, i) => (
          <OptionCard
            key={opt.value}
            icon={opt.icon}
            label={opt.label}
            selected={data.role === opt.value}
            fullWidth={i === ROLE_OPTIONS.length - 1}
            onClick={() => setField("role", opt.value)}
          />
        ))}
      </>
    );
  }
  if (step === 1) {
    return (
      <>
        {PROJECT_OPTIONS.map((opt) => (
          <OptionCard
            key={opt.value}
            icon={opt.icon}
            label={opt.label}
            selected={data.projectType === opt.value}
            onClick={() => setField("projectType", opt.value)}
          />
        ))}
      </>
    );
  }
  if (step === 2) {
    return (
      <>
        {AI_TOOL_OPTIONS.map((opt, i) => (
          <OptionCard
            key={opt.value}
            icon={opt.icon}
            label={opt.label}
            multi
            selected={data.aiTools.includes(opt.value)}
            fullWidth={i === AI_TOOL_OPTIONS.length - 1}
            onClick={() => toggleTool(opt.value)}
          />
        ))}
      </>
    );
  }
  return (
    <>
      {START_OPTIONS.map((opt) => (
        <OptionCard
          key={opt.value}
          icon={opt.icon}
          label={opt.label}
          selected={data.startMode === opt.value}
          onClick={() => setField("startMode", opt.value)}
        />
      ))}
    </>
  );
}

// ---- Main wizard -----------------------------------------------------------

export function OnboardingWizard() {
  const appStage = useAutumnStore((s) => s.appStage);
  const step = useAutumnStore((s) => s.onboardingStep);
  const data = useAutumnStore((s) => s.onboardingData);
  const setStep = useAutumnStore((s) => s.setOnboardingStep);
  const setField = useAutumnStore((s) => s.setOnboardingField);
  const toggleTool = useAutumnStore((s) => s.toggleAiTool);
  const complete = useAutumnStore((s) => s.completeOnboarding);
  const skip = useAutumnStore((s) => s.skipOnboarding);

  if (appStage !== "onboarding") return null;

  const isStepComplete = (): boolean => {
    if (step === 0) return !!data.role;
    if (step === 1) return !!data.projectType;
    if (step === 2) return data.aiTools.length > 0;
    if (step === 3) return !!data.startMode;
    return false;
  };

  const handleContinue = () => {
    if (!isStepComplete()) return;
    if (step === 3) {
      complete();
    } else {
      setStep(step + 1);
    }
  };

  const handleBack = () => {
    if (step > 0) setStep(step - 1);
  };

  const stepComplete = isStepComplete();
  const current = STEPS[step] ?? STEPS[0];

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label="Autumn onboarding"
      className="fixed inset-0 z-[200] flex flex-col bg-black"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4 }}
    >
      {/* Top bar */}
      <header className="relative z-10 flex items-center justify-between px-6 py-4 sm:px-10">
        <div className="flex items-center gap-2">
          <AutumnLogo size={24} />
          <span className="text-sm font-semibold text-foreground/90">Autumn</span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={skip}
          className="text-muted-foreground hover:text-foreground"
        >
          Skip for now
          <ArrowRight className="size-3.5" />
        </Button>
      </header>

      {/* Progress */}
      <div className="relative z-10 px-6 sm:px-10">
        <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
          <span className="font-mono tabular-nums text-foreground/70">
            {step + 1} / 4
          </span>
          <span className="hidden sm:inline">{current.subtitle}</span>
        </div>
        <div className="h-1 w-full overflow-hidden rounded-full bg-border/50">
          <motion.div
            className="h-full rounded-full bg-violet-600"
            initial={{ width: 0 }}
            animate={{ width: `${((step + 1) / 4) * 100}%` }}
            transition={{ duration: 0.4, ease: "easeInOut" }}
          />
        </div>
      </div>

      {/* Main two-column area */}
      <main className="relative z-10 flex flex-1 items-center justify-center overflow-y-auto px-6 py-6 sm:px-10">
        <div className="grid w-full max-w-6xl grid-cols-1 items-center gap-8 lg:grid-cols-[1.5fr_1fr] lg:gap-12">
          {/* Left column: question + options */}
          <div className="order-1">
            <AnimatePresence mode="wait">
              <motion.div
                key={step}
                initial={{ opacity: 0, x: 24 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -24 }}
                transition={{ duration: 0.3, ease: "easeOut" }}
              >
                <h2 className="mb-2 text-2xl font-bold text-foreground sm:text-3xl">
                  {current.title}
                </h2>
                <p className="mb-6 text-sm text-muted-foreground">
                  {current.subtitle}
                </p>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <StepOptions
                    step={step}
                    data={data}
                    setField={setField}
                    toggleTool={toggleTool}
                  />
                </div>
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Right column: preview pane */}
          <div className="order-2 rounded-2xl bg-gradient-to-br from-[#1a2332] to-[#2d3748] p-6">
            <PreviewPane step={step} data={data} />
          </div>
        </div>
      </main>

      {/* Bottom controls */}
      <footer className="relative z-10 flex items-center justify-between gap-3 px-6 py-5 sm:px-10">
        <div className="min-w-24">
          {step > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleBack}
              className="gap-1.5 text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="size-4" />
              Back
            </Button>
          ) : null}
        </div>

        <div className="flex flex-col items-end gap-1.5">
          <span className="text-[11px] text-muted-foreground">
            {stepComplete
              ? step === 3
                ? "Ready to enter Autumn"
                : "Looks good — tap to continue"
              : "Select an option to continue"}
          </span>
          <Button
            onClick={handleContinue}
            disabled={!stepComplete}
            size="lg"
            className="gap-2 bg-violet-600 text-white hover:bg-violet-500 disabled:opacity-40"
          >
            {step === 3 ? "Enter Autumn" : "Continue"}
            {step === 3 ? (
              <Sparkles className="size-4" />
            ) : (
              <ArrowRight className="size-4" />
            )}
          </Button>
        </div>
      </footer>
    </motion.div>
  );
}
