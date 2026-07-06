/** Inline SVG tool icons. Unicode symbols (◉ ◎ ◔ ⌗ …) render as tofu boxes on
 * many Windows font stacks, so every toolbar icon is drawn as an SVG path. */

import type { Tool } from "../types";

const S = 18;

function Svg({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <svg
      width={S}
      height={S}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  );
}

export const TOOL_ICONS: Record<Tool, JSX.Element> = {
  pan: (
    <Svg>
      <path d="M8 12V6.5a1.5 1.5 0 0 1 3 0V11m0-5.5v-1a1.5 1.5 0 0 1 3 0V11m0-4.5a1.5 1.5 0 0 1 3 0V13m0-3.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1.6a6 6 0 0 1-4.6-2.15L4.6 15.1a1.7 1.7 0 0 1 2.6-2.2L8 14.2" />
    </Svg>
  ),
  point: (
    <Svg>
      <circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="7" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
    </Svg>
  ),
  rect: (
    <Svg>
      <rect x="4" y="6" width="16" height="12" rx="1" />
    </Svg>
  ),
  ellipse: (
    <Svg>
      <ellipse cx="12" cy="12" rx="8.5" ry="6" />
    </Svg>
  ),
  annulus: (
    <Svg>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4" />
    </Svg>
  ),
  wedge: (
    <Svg>
      <path d="M12 12 20.5 8.2A9 9 0 0 0 20.5 15.8Z" fill="currentColor" stroke="none" opacity="0.9" />
      <circle cx="12" cy="12" r="9" opacity="0.45" />
      <path d="M12 12 3.5 8.2A9 9 0 0 1 3.5 15.8Z" opacity="0.6" />
    </Svg>
  ),
  brush: (
    <Svg>
      <path d="M4 20c1.2-.3 2.4-.4 3.2-1.2.9-.9.9-2.3 0-3.1-.9-.9-2.3-.9-3.1 0C3.3 16.5 3.3 18.6 4 20Z" fill="currentColor" stroke="none" />
      <path d="M8.5 15.5 18.5 4.5a1.9 1.9 0 0 1 2.8 2.6L11 17.5" />
    </Svg>
  ),
  roi: (
    <Svg>
      <path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" />
      <path d="M9 12h6M12 9v6" opacity="0.7" />
    </Svg>
  ),
  annotate: (
    <Svg>
      <path d="M17.3 3.7a2.1 2.1 0 0 1 3 3L8 19l-4.2 1.2L5 16Z" />
      <path d="M14.5 6.5l3 3" opacity="0.7" />
    </Svg>
  ),
};

/** Small non-tool icons reused around the UI (also tofu-safe). */
export const UI_ICONS = {
  locate: (
    <Svg>
      <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="6.5" />
      <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3" />
    </Svg>
  ),
};
