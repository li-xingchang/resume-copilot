/**
 * Onboarding state machine.
 * In dev mode (no Clerk), state is persisted in localStorage.
 * Replace with a DB-backed API call once Clerk is wired up.
 */

export type OnboardingStep = "upload" | "verify" | "first_score" | "extension" | "complete";

const KEY = "onboarding_state";

export function getOnboardingStep(): OnboardingStep {
  if (typeof window === "undefined") return "upload";
  return (localStorage.getItem(KEY) as OnboardingStep) ?? "upload";
}

export function setOnboardingStep(step: OnboardingStep) {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, step);
}

export function resetOnboarding() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(KEY);
  localStorage.removeItem("onboarding_facts");
  localStorage.removeItem("onboarding_score");
  localStorage.removeItem("onboarding_jd_hash");
}

export function saveOnboardingFacts(facts: unknown[]) {
  localStorage.setItem("onboarding_facts", JSON.stringify(facts));
}

export function getOnboardingFacts(): unknown[] {
  try {
    return JSON.parse(localStorage.getItem("onboarding_facts") ?? "[]");
  } catch {
    return [];
  }
}

export function saveOnboardingScore(score: unknown, jdHash: string) {
  localStorage.setItem("onboarding_score", JSON.stringify(score));
  localStorage.setItem("onboarding_jd_hash", jdHash);
}

export function getOnboardingScore() {
  try {
    return {
      score: JSON.parse(localStorage.getItem("onboarding_score") ?? "null"),
      jdHash: localStorage.getItem("onboarding_jd_hash") ?? "",
    };
  } catch {
    return { score: null, jdHash: "" };
  }
}

// Analytics — swap for Posthog in prod
export function track(event: string, props?: Record<string, unknown>) {
  console.log(`[onboarding] ${event}`, props ?? "");
}

// Demo JD — Stripe Senior PM role
export const DEMO_JD = `About Stripe
Stripe is a financial infrastructure platform for businesses. Millions of companies—from the world's largest enterprises to the most ambitious startups—use Stripe to accept payments, grow their revenue, and accelerate new business opportunities.

About the Role
We're looking for a Senior Product Manager to lead our Payments Acceptance team. You'll own the roadmap for how millions of businesses accept money globally.

What you'll do
- Define and drive the product strategy for payment acceptance across web, mobile, and in-person
- Partner with Engineering, Design, and Data Science to ship high-quality product experiences
- Analyse conversion funnels, identify drop-off points, and run structured experiments
- Synthesise feedback from enterprise customers, support tickets, and market research
- Work cross-functionally with Sales, Marketing, and Partnerships to launch new products
- Communicate roadmap and trade-offs clearly to executives and stakeholders

Who you are
- 5+ years of product management experience, ideally in fintech or payments
- Track record of shipping 0→1 products and iterating with data
- Strong SQL skills for self-serve analysis
- Experience running A/B tests and interpreting results rigorously
- Excellent written and verbal communication
- Bachelor's degree or equivalent experience`;

export const STEPS: { key: OnboardingStep; label: string; description: string }[] = [
  { key: "upload", label: "Upload Resume", description: "We extract your career memory" },
  { key: "verify", label: "Verify Facts", description: "Confirm we got it right" },
  { key: "first_score", label: "Score a Job", description: "See your match instantly" },
  { key: "extension", label: "Install Extension", description: "Score jobs automatically" },
];
