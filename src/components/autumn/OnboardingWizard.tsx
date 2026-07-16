// Autumn — Onboarding Wizard.
// Full-screen 4-step onboarding flow. Layout mirrors October Desktop's wizard:
// edge-to-edge two-column split (45% left / 55% right), label-only option
// buttons in a single row, "Skip for now" top-right of the left column, and a
// thin progress bar pinned to the bottom of the left column. The right column
// shows a centered app-window mockup. Colors stay Autumn amber/orange.
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
  icon: LucideIcon; // kept for the preview pane chips; the option buttons themselves are label-only
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

// Current step's option list (for the mockup chip row + the option buttons).
function optionsForStep(step: number): OptionDef<string>[] {
  if (step === 0) return ROLE_OPTIONS as unknown as OptionDef<string>[];
  if (step === 1) return PROJECT_OPTIONS as unknown as OptionDef<string>[];
  if (step === 2) return AI_TOOL_OPTIONS;
  return START_OPTIONS as unknown as OptionDef<string>[];
}

// ---- Label-only option button (matches reference: centered, no icon) ------

function OptionButton({
  label,
  selected,
  multi,
  onClick,
}: {
  label: string;
  selected: boolean;
  multi?: boolean;
  onClick: () => void;
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      aria-pressed={selected}
      className={cn(
        "relative flex h-11 items-center justify-center rounded-lg border px-3 text-center text-sm font-medium transition-all duration-200",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/40",
        selected
          ? "border-amber-500/60 bg-amber-500/10 text-amber-100"
          : "border-border/50 bg-card/40 text-foreground/70 hover:border-border hover:bg-accent/40 hover:text-foreground",
      )}
    >
      {label}
      {/* compact selection tick — corner, not a big circle */}
      {selected && (
        <motion.span
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0, opacity: 0 }}
          transition={{ type: "spring", stiffness: 500, damping: 25 }}
          className="absolute right-1.5 top-1.5 flex size-3.5 items-center justify-center rounded-full bg-amber-500 text-white"
        >
          <Check className="size-2.5" strokeWidth={3} />
        </motion.span>
      )}
      {multi && !selected && (
        <span className="absolute right-1.5 top-1.5 size-3.5 rounded-full border border-border/60" />
      )}
    </motion.button>
  );
}

// ---- App-window mockup (right column) --------------------------------------

function AppMockup({ step, data }: { step: number; data: OnboardingData }) {
  const opts = optionsForStep(step);
  // Reflect the current selection in the mockup's chip row.
  const selectedLabels: string[] = [];
  if (step === 0 && data.role) selectedLabels.push(ROLE_LABEL[data.role]);
  if (step === 1 && data.projectType) selectedLabels.push(PROJECT_LABEL[data.projectType]);
  if (step === 2) selectedLabels.push(...data.aiTools.map((t) => AI_TOOL_LABEL[t] ?? t));
  if (step === 3 && data.startMode) selectedLabels.push(START_LABEL[data.startMode]);

  return (
    <div className="w-full max-w-md rounded-xl border border-white/10 bg-[#0a0d12] shadow-2xl shadow-black/50 overflow-hidden">
      {/* Window top bar — traffic lights + title + circle */}
      <div className="flex items-center gap-2 border-b border-white/5 bg-white/[0.02] px-4 py-2.5">
        <div className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-rose-500/70" />
          <span className="size-2.5 rounded-full bg-amber-400/70" />
          <span className="size-2.5 rounded-full bg-emerald-500/70" />
        </div>
        <div className="mx-auto flex items-center gap-2">
          <span className="size-4 rounded bg-amber-500/80" />
          <span className="text-xs font-medium text-foreground/70">
            Autumn · Your Big Idea
          </span>
        </div>
        {/* spacer to balance the traffic lights on the left (keeps the title centered) */}
        <div className="w-12" aria-hidden />
      </div>

      {/* Window body — centered logo + tagline */}
      <div className="flex flex-col items-center justify-center gap-3 px-6 py-12">
        <AutumnLogo size={56} glow />
        <p className="text-sm font-medium text-foreground/80">
          Built for whoever ships.
        </p>

        {/* Chip row mirroring the current step's options */}
        <div className="mt-4 flex flex-wrap items-center justify-center gap-1.5">
          {opts.map((o) => {
            const isSel = selectedLabels.includes(o.label);
            return (
              <span
                key={o.value}
                className={cn(
                  "rounded-md border px-2 py-0.5 text-[10px] font-medium transition-colors",
                  isSel
                    ? "border-amber-500/50 bg-amber-500/15 text-amber-200"
                    : "border-white/5 bg-white/[0.02] text-muted-foreground/60",
                )}
              >
                {o.label}
              </span>
            );
          })}
        </div>
      </div>
    </div>
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
        {ROLE_OPTIONS.map((opt) => (
          <OptionButton
            key={opt.value}
            label={opt.label}
            selected={data.role === opt.value}
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
          <OptionButton
            key={opt.value}
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
        {AI_TOOL_OPTIONS.map((opt) => (
          <OptionButton
            key={opt.value}
            label={opt.label}
            multi
            selected={data.aiTools.includes(opt.value)}
            onClick={() => toggleTool(opt.value)}
          />
        ))}
      </>
    );
  }
  return (
    <>
      {START_OPTIONS.map((opt) => (
        <OptionButton
          key={opt.value}
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

  const stepComplete = isStepComplete();
  const current = STEPS[step] ?? STEPS[0];
  const opts = optionsForStep(step);
  // Layout per step:
  //   5 options (role)       → 3 on top + 2 on bottom (sm+), 2-col on mobile
  //   6 options (AI tools)   → 3 + 3 (sm+), 2-col on mobile
  //   4 options (project)    → single row of 4 (sm+), 2x2 on mobile
  //   3 options (start mode) → single row of 3
  const gridCols =
    opts.length >= 5
      ? "grid-cols-2 sm:grid-cols-3"
      : opts.length === 4
        ? "grid-cols-2 sm:grid-cols-4"
        : "grid-cols-2 sm:grid-cols-3";

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label="Autumn onboarding"
      className="fixed inset-0 z-[200] flex flex-col bg-black lg:flex-row"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4 }}
    >
      {/* ============ LEFT COLUMN (45%) ============ */}
      <section className="flex h-full flex-col bg-black lg:w-[45%] lg:min-w-[45%]">
        {/* Top row — empty left, "Skip for now" right */}
        <div className="flex items-start justify-end px-6 pt-6 sm:px-10 sm:pt-8">
          <button
            type="button"
            onClick={skip}
            className="text-xs text-muted-foreground/70 transition-colors hover:text-foreground"
          >
            Skip for now
          </button>
        </div>

        {/* Middle — heading + subtitle + options, top-aligned */}
        <div className="flex flex-1 flex-col justify-start px-6 pt-10 sm:px-10 sm:pt-16">
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
              transition={{ duration: 0.3, ease: "easeOut" }}
            >
              <h2 className="mb-2 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                {current.title}
              </h2>
              <p className="mb-8 text-sm text-muted-foreground">
                {current.subtitle}
              </p>

              {/* Option buttons — single row, label-only, centered text */}
              <div className={cn("grid gap-2.5", gridCols)}>
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

        {/* Bottom — thin progress bar + step counter + "Tap to continue" */}
        <div className="px-6 pb-6 pt-4 sm:px-10 sm:pb-8">
          <div className="mb-2 flex items-center justify-between text-[11px] text-muted-foreground">
            <span className="font-mono tabular-nums text-foreground/60">
              {step + 1} / 4
            </span>
            <button
              type="button"
              onClick={handleContinue}
              disabled={!stepComplete}
              className={cn(
                "transition-colors",
                stepComplete
                  ? "text-amber-300 hover:text-amber-200"
                  : "text-muted-foreground/50",
              )}
            >
              {stepComplete
                ? step === 3
                  ? "Tap to enter Autumn →"
                  : "Tap to continue →"
                : "Select an option to continue"}
            </button>
          </div>
          <div className="h-[3px] w-full overflow-hidden rounded-full bg-border/40">
            <motion.div
              className="h-full rounded-full bg-amber-500"
              initial={{ width: 0 }}
              animate={{ width: `${((step + 1) / 4) * 100}%` }}
              transition={{ duration: 0.4, ease: "easeInOut" }}
            />
          </div>
        </div>
      </section>

      {/* ============ RIGHT COLUMN (55%) — app-window mockup ============ */}
      <section className="relative flex h-full items-center justify-center overflow-hidden bg-gradient-to-br from-[#141821] via-[#0f1218] to-[#0a0d12] lg:w-[55%] lg:min-w-[55%]">
        {/* subtle top glow */}
        <div
          aria-hidden
          className="pointer-events-none absolute -top-32 left-1/2 h-64 w-[36rem] -translate-x-1/2 rounded-full bg-amber-500/[0.06] blur-3xl"
        />
        <div className="relative z-10 flex w-full items-center justify-center px-6 py-12 sm:px-12">
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.02 }}
              transition={{ duration: 0.3, ease: "easeOut" }}
              className="flex w-full justify-center"
            >
              <AppMockup step={step} data={data} />
            </motion.div>
          </AnimatePresence>
        </div>
      </section>
    </motion.div>
  );
}
