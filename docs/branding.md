# Brand

Autumn's brand is a **maple leaf** and the word **AUTUMN**. Nothing else.

## The mark

![the Autumn maple leaf](../public/maple-leaf.png)

| Asset | File | Use |
|---|---|---|
| The mark | `public/maple-leaf.png` (512×512, transparent) | The app icon, the favicon, the in-app brand mark, the installer icon. |
| The installer icon | `assets/icon.png` (512×512, transparent) | The source for the Windows `.ico` and the macOS `.icns` that `electron-builder` generates. |
| The wordmark | `brand/autumn-ascii.txt` | The README, the release notes, anywhere a terminal is. |

Both PNGs are the same artwork. The in-app mark is rendered by
`src/components/autumn/AutumnLogo.tsx`:

```tsx
<AutumnLogo size={32} />           // a header
<AutumnLogo size={64} glow />      // an empty state
<AutumnLogo size={80} priority />  // above the fold
```

`public/maple-leaf.png` is also what `src/app/layout.tsx` registers as the icon
and the Apple touch icon, so the browser tab, the taskbar and the installer all
show the same leaf.

## The wordmark

```
         _    _ _______ _    _ __  __ _   _ 
    /\  | |  | |__   __| |  | |  \/  | \ | |
   /  \ | |  | |  | |  | |  | | \  / |  \| |
  / /\ \| |  | |  | |  | |  | | |\/| | . ` |
 / ____ \ |__| |  | |  | |__| | |  | | |\  |
/_/    \_\____/   |_|   \____/|_|  |_|_| \_|
```

It lives in [`brand/autumn-ascii.txt`](../brand/autumn-ascii.txt) so it can be
pasted anywhere. It is drawn with `figlet -f big AUTUMN`; keep the file and the
README in sync if you ever change it.

## The palette

The leaf carries the palette, so the UI borrows from it.

| Token | Value | Used for |
|---|---|---|
| Amber | `#f59e0b` | The accent: active state, highlights, the leaf glow. |
| Leaf orange | `#f97316` → `#ea580c` | The gradient on the leaf, the warm surfaces. |
| Leaf deep | `#c2410c` | The leaf veins and the deepest warm shade. |

The app is dark by default (`<html class="dark">`) and the leaf reads well
against it — the glow is `rgba(245,158,11,0.45)`.

## Rules

1. **The leaf is the mark.** Do not redraw it, recolour it or put it in a
   rounded box. It is a leaf.
2. **Do not stretch it.** It is square; render it square.
3. **The wordmark is uppercase.** `AUTUMN`, never `Autumn` in the ASCII form.
4. **Keep the clear space.** Leave at least a quarter of the leaf's width around
   it, so it never touches a panel edge or a line of text.
5. **On dark surfaces use the leaf as-is.** It is already transparent, so it
   needs no container.

## Where the brand appears

| Surface | File |
|---|---|
| Browser tab / PWA icon | `src/app/layout.tsx` |
| The app's brand mark | `src/components/autumn/AutumnLogo.tsx` |
| The installer's icon | `assets/icon.png` → `electron-builder.cjs` |
| The README | `README.md` |
