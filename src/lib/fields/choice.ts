// Choice questions: several answer boxes placed wherever the document shows its options.

export const CHOICE_MARKS = ["check", "cross", "circle", "text"] as const;
export type ChoiceMark = (typeof CHOICE_MARKS)[number];

export const MARK_LABELS: Record<ChoiceMark, string> = {
  check: "Tick the box",
  cross: "Cross the box",
  circle: "Circle it",
  text: "Write the answer",
};

export const MAX_OPTIONS = 10;
export const MAX_OPTION = 40;
export const MAX_LABEL = 80;
export const DEFAULT_OPTIONS = ["Yes", "No"];
// One answer box: about the size of a printed check box.
export const OPTION_SIZE = { w: 0.03, h: 0.023 };
