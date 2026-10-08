// Small stroke icons (24px grid). Kept local: the app must work offline.

const paths: Record<string, string> = {
  move: "M8 11V5.5a1.5 1.5 0 0 1 3 0V11m0-1V4.5a1.5 1.5 0 0 1 3 0V11m0-.5V6.5a1.5 1.5 0 0 1 3 0V14a6 6 0 0 1-6 6h-1a6 6 0 0 1-4.6-2.2L3.6 14a1.5 1.5 0 0 1 2.3-1.9L8 14.5V11",
  rect: "M4 6h16v12H4z",
  ellipse: "M12 5c4.4 0 8 3.1 8 7s-3.6 7-8 7-8-3.1-8-7 3.6-7 8-7z",
  arrow: "M5 19L19 5M10 5h9v9",
  pen: "M4 20c3-1 4-6 7-6s3 3 5 3 3-2 4-3M15 4l5 5-9 9H6v-5z",
  text: "M5 6V4h14v2M12 4v16M9 20h6",
  undo: "M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3",
  trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
  crosshair: "M12 3v6M12 15v6M3 12h6M15 12h6M12 12h.01",
  compare: "M4 5h7v14H4zM13 5h7v14h-7z",
  download: "M12 4v11M7 10l5 5 5-5M5 20h14",
  open: "M4 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z",
  fit: "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5",
  actual: "M7 8v8M7 8l-1.5 1.5M17 8v8M17 8l-1.5 1.5M12 10.5h.01M12 14h.01",
  close: "M6 6l12 12M18 6L6 18",
  help: "M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17.5h.01",
  shield: "M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z",
  chevron: "M8 10l4 4 4-4",
};

export default function Icon({ name, size = 18 }: { name: keyof typeof paths | string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={paths[name] ?? ""} />
    </svg>
  );
}
