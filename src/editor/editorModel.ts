export type Position = { x: number; y: number };

export type CaptionAppearance = {
  theme: string;
  color: string;
  accentColor: string;
  fontFamily: string;
  fontSize: number;
  position: Position;
};

export type OnScreenText = {
  id: string;
  text: string;
  styleId: string;
  color: string;
  position: Position;
  scale: number;
  opacity: number;
};

export type LogoOverlay = {
  src: string;
  position: Position;
  scale: number;
  opacity: number;
};

export type EditorOverlayState = {
  caption: CaptionAppearance;
  globalCaptionPosition: Position;
  linePositions: Record<string, Position>;
  onScreenText: OnScreenText[];
  logo: LogoOverlay | null;
};

export const DEFAULT_EDITOR_OVERLAYS: EditorOverlayState = {
  caption: {
    theme: "pop",
    color: "#ffffff",
    accentColor: "#ffd84a",
    fontFamily: "Anton, sans-serif",
    fontSize: 72,
    position: { x: 50, y: 72 },
  },
  globalCaptionPosition: { x: 50, y: 72 },
  linePositions: {},
  onScreenText: [],
  logo: null,
};

export function positionStyle(position: Position) {
  return { left: `${position.x}%`, top: `${position.y}%` };
}
