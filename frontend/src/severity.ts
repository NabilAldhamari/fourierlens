// How strongly an automatic check points at a lead.

export const STRONG_SEVERITY = 0.7;
export const MODERATE_SEVERITY = 0.4;

export type SeverityLevel = "strong" | "moderate" | "weak";

export const SEVERITY_LABELS: Record<SeverityLevel, string> = {
  strong: "Strong",
  moderate: "Moderate",
  weak: "Weak",
};

export function severityLevel(severity: number): SeverityLevel {
  if (severity >= STRONG_SEVERITY) return "strong";
  if (severity >= MODERATE_SEVERITY) return "moderate";
  return "weak";
}
