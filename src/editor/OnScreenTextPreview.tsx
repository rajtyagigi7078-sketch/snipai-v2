import type { CSSProperties } from "react";
import "./editorModel.css";

export type TextTheme = { id: string; label: string; font: string; color: string; accent: string; animation: string };

export const ON_SCREEN_TEXT_THEMES: TextTheme[] = [
  { id: "pop", label: "Pop", font: "Poppins, sans-serif", color: "#FFFFFF", accent: "#FFE500", animation: "pop" },
  { id: "bold-center", label: "Bold Center", font: "Anton, sans-serif", color: "#FFFFFF", accent: "#FFFFFF", animation: "fade" },
  { id: "bounce", label: "Steady Highlight", font: "Rubik, sans-serif", color: "#FFFFFF", accent: "#FF2D9A", animation: "fade" },
  { id: "highlight-box", label: "Teal Highlight Box", font: "Kanit, sans-serif", color: "#FFFFFF", accent: "#0F766E", animation: "fade" },
  { id: "karaoke", label: "Karaoke", font: "League Spartan, sans-serif", color: "#D9D9D9", accent: "#00E5FF", animation: "fade" },
  { id: "minimal", label: "Minimal Fade", font: "Nunito, sans-serif", color: "#F5F5F5", accent: "#FFFFFF", animation: "fade" },
  { id: "podcast", label: "Podcast", font: "Bebas Neue, sans-serif", color: "#FFFFFF", accent: "#FFD928", animation: "fade" },
  { id: "typewriter", label: "Typewriter", font: "Teko, sans-serif", color: "#FFFFFF", accent: "#22C55E", animation: "fade" },
  { id: "kinetic", label: "Kinetic", font: "Oswald, sans-serif", color: "#FFFFFF", accent: "#00E5FF", animation: "fade" },
  { id: "punch", label: "Punch", font: "Alfa Slab One, serif", color: "#FFFFFF", accent: "#FF2A2A", animation: "pop" },
  { id: "yellow-stack", label: "Sunny Stack", font: "Anton, sans-serif", color: "#FFD928", accent: "#FFD928", animation: "fade" },
  { id: "violet-pill", label: "Violet Pill", font: "Poppins, sans-serif", color: "#FFFFFF", accent: "#8B5CF6", animation: "fade" },
  { id: "dual-line", label: "Dual-Line Lyric", font: "Anton, sans-serif", color: "#FFD928", accent: "#FFFFFF", animation: "fade" },
  { id: "bold-karaoke", label: "Reel Karaoke", font: "Anton, sans-serif", color: "#FFFFFF", accent: "#FFD928", animation: "fade" },
  { id: "soft-lyric", label: "Soft Lyric", font: "Nunito, sans-serif", color: "#F4F1EA", accent: "#FFFFFF", animation: "fade" },
];

export function OnScreenTextPreview({ theme, text = "YOUR TEXT" }: { theme: TextTheme; text?: string }) {
  const style: CSSProperties = { fontFamily: theme.font, color: theme.color, "--text-accent": theme.accent } as CSSProperties;
  return <div className={`on-screen-text-preview text-style-${theme.id}`}><span style={style}>{text}</span></div>;
}
