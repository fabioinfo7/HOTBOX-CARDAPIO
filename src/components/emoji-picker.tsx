import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/** Seletor de emojis leve — sem dependência externa, só uma grade com os
 *  emojis mais usados em atendimento, agrupados por categoria (igual ao
 *  seletor do WhatsApp, só que simplificado). */
const EMOJI_CATEGORIES: { label: string; emojis: string[] }[] = [
  {
    label: "Usados",
    emojis: ["😀", "😂", "😍", "🙏", "👍", "❤️", "🔥", "🎉", "😅", "🥳"],
  },
  {
    label: "Rostos",
    emojis: [
      "😀",
      "😃",
      "😄",
      "😁",
      "😆",
      "😅",
      "😂",
      "🙂",
      "😉",
      "😊",
      "😇",
      "🥰",
      "😍",
      "😘",
      "😋",
      "😜",
      "🤔",
      "🤗",
      "🙄",
      "😴",
      "😢",
      "😭",
      "😡",
      "😱",
      "🥳",
      "😎",
      "🤝",
      "👏",
      "🙌",
      "👍",
      "👎",
      "🙏",
      "💪",
      "✌️",
    ],
  },
  {
    label: "Corações",
    emojis: ["❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "💔", "💕", "💖", "💯"],
  },
  {
    label: "Comida",
    emojis: ["🍔", "🍟", "🍕", "🌭", "🥤", "🍗", "🍖", "🥓", "🧀", "🥗", "🍰", "🎂", "☕", "🍺"],
  },
  {
    label: "Outros",
    emojis: ["✅", "❌", "⏰", "📍", "💳", "💵", "📦", "🚚", "🏍️", "⭐", "🎁", "📱", "🔔", "✨"],
  },
];

export function EmojiPicker({ onSelect }: { onSelect: (emoji: string) => void }) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="grid size-9 shrink-0 place-items-center rounded-full text-[#54656F] hover:bg-black/5"
          title="Emojis"
        >
          <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8">
            <circle cx="12" cy="12" r="9.5" />
            <path d="M8.5 10.5h.01M15.5 10.5h.01" strokeLinecap="round" />
            <path d="M8 14.5c1 1.2 2.4 1.8 4 1.8s3-.6 4-1.8" strokeLinecap="round" />
          </svg>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-2" align="start" side="top">
        <div className="max-h-64 space-y-2 overflow-y-auto">
          {EMOJI_CATEGORIES.map((cat) => (
            <div key={cat.label}>
              <p className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {cat.label}
              </p>
              <div className="grid grid-cols-8 gap-0.5">
                {cat.emojis.map((e, i) => (
                  <button
                    key={`${cat.label}-${i}`}
                    type="button"
                    className="grid size-8 place-items-center rounded text-lg hover:bg-muted"
                    onClick={() => {
                      onSelect(e);
                      setOpen(false);
                    }}
                  >
                    {e}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
