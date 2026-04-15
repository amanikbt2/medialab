# AI Insert Agent - Flexible Element Creation Guide

## Overview

The enhanced AI insert agent now supports creating any element with full control over HTML, CSS, styling, attributes, and animations. No more limitations!

## What You Can Do Now

### 1. **Glowing Buttons**

```
"insert a glowing cyan button with intense glow and says Submit, size large"
```

### 2. **Custom Styled Elements**

```
"insert a purple card with rounded edges, gradient background, and drop shadow"
```

### 3. **Animated Elements**

```
"insert a spinning neon green circle with pulsing glow animation"
```

### 4. **Complex Layouts via AI**

```
"insert a hero section with gradient background, centered title, and call-to-action button"
```

## How It Works

### For Quick Inserts

Just say natural language like:

- "insert glowing button"
- "insert large neon pink card with glow"
- "insert blue rounded container"
- "insert text with shadow"

The system will automatically parse your description and create the element with the right styles.

### For Complex Custom Inserts (AI Agent)

The AI can use the new `INSERT_ELEMENT_SPEC` action to create arbitrary elements:

```json
[ACTION]
{INSERT_ELEMENT_SPEC}
{
  "html": "<button>Click Me</button>",
  "css": "@keyframes glow { 0%,100% { box-shadow: 0 0 10px #0ff; } 50% { box-shadow: 0 0 30px #0ff; } }",
  "style": {
    "width": "200px",
    "height": "50px",
    "backgroundColor": "#0ff",
    "color": "#000",
    "borderRadius": "25px",
    "border": "2px solid #0ff",
    "fontSize": "18px",
    "fontWeight": "bold",
    "animation": "glow 2s ease-in-out infinite"
  },
  "x": 100,
  "y": 200,
  "attributes": {
    "onclick": "alert('Clicked!')",
    "data-role": "cta"
  }
}
[/ACTION]
```

## Advanced Features

### Supported CSS Properties

- `backgroundColor` / `background`
- `color` (text color)
- `borderRadius` (rounded corners)
- `boxShadow` (glows, shadows)
- `fontSize`, `fontWeight`
- `animation` (connect to keyframes in css)
- `backdropFilter` (frosted glass effect)
- Any other CSS property name in camelCase

### Supported Attributes

- `onclick` - click handler
- `data-*` - data attributes
- `aria-*` - accessibility attributes
- `class` - CSS classes
- `id` - element ID
- Any standard HTML attribute

### Effect Keywords

The parser recognizes these natural language descriptions:

**Glow Effects:**

- "glow", "luminous", "radiant", "neon", "shiny", "glint", "sparkle"

**Gradients:**

- "gradient", "multi-color", "colorful", "rainbow", "blend", "fade"

**Shapes:**

- "round", "rounded", "circular", "pill", "smooth", "curve"

**Decorations:**

- "border", "outline", "stroke", "edge", "frame"

**Glass/Transparency:**

- "blur", "frosted", "glass", "transparent", "see-through"

**Animations:**

- "animate", "spin", "rotate", "bounce", "pulse", "float", "wave", "vibrate", "shake", "scale"

**Sizes:**

- Tiny, Mini, Small, Compact, Medium, Large, XL, Huge, Big, 2XL, 3XL

## Example Commands

### Glowing Cyan Button with Text

```
insert a large glowing cyan button with intense neon glow and says "Launch App", size 2xl
```

### Rainbow Gradient Card

```
insert a colorful gradient card with rounded edges and shadow, medium size, with rainbow blend
```

### Spinning Loading Spinner

```
insert a spinning blue circle with pulsing glow animation
```

### Frosted Glass Container

```
insert a frosted glass container with blur effect and smooth rounded edges
```

### Multi-colored Animated Ball

```
insert a large bouncing circle with multi-color gradient and glowing edges
```

## Technical Implementation

### Action Block Format

```
[ACTION]{INSERT_ELEMENT_SPEC}JSON_PAYLOAD[/ACTION]
```

### JSON Schema

```json
{
  "type": "INSERT_ELEMENT_SPEC",
  "html": "HTML content (optional)",
  "css": "CSS @keyframes and styles (optional)",
  "style": { "CSS properties as object" },
  "className": "Additional CSS classes",
  "width": "element width (e.g., '200px')",
  "height": "element height (e.g., '50px')",
  "x": 100,
  "y": 200,
  "attributes": { "HTML attributes" },
  "animations": "CSS animation keyframes",
  "id": "optional element ID",
  "text": "text content if no HTML"
}
```

## Limitations & Notes

1. **Canvas Only** - Inserts are added to the canvas directly
2. **Live Updates** - Changes sync back to code editor
3. **Multiple Inserts** - Use multiple INSERT_ELEMENT_SPEC blocks
4. **Batch Operations** - Works with other AI actions (UPDATE_FILE, etc.)

## Tips & Tricks

1. **Use Natural Language** - The AI understands descriptive commands
2. **Be Specific** - "glowing" vs "intense neon glow" make a difference
3. **Combine Effects** - Mix colors, sizes, animations, and effects
4. **Inspect Results** - Check the code editor to see generated HTML/CSS
5. **Chain Actions** - Insert multiple elements in one command

## Example: Complete Hero Section

```
insert a hero section with a gradient background from blue to purple, centered heading that says "Welcome to My App", and a large glowing orange button below it that says "Get Started", with a subtle floating animation
```

The AI will intelligently break this down into:

- Background gradient
- Heading text
- Call-to-action button with glow
- Animation keyframes

All positioned correctly on the canvas!

---

## Quick Reference: What Changed

| Before                | Now                    |
| --------------------- | ---------------------- |
| Limited element types | Any HTML possible      |
| Basic styling         | Full CSS control       |
| No animations         | Animation support      |
| Predefined colors     | Any color + effects    |
| No custom attributes  | Full attribute support |
| Manual positioning    | Flexible positioning   |

Enjoy creating with maximum flexibility! 🚀
