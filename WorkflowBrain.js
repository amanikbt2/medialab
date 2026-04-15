/**
 * WorkflowBrain.js
 *
 * Core AI-powered insert and processing system for MediaLab
 * Handles intelligent element generation, background detection, and command normalization
 *
 * Dependencies: None (pure functions - external dependencies injected)
 * Usage: Import and configure with external functions (setAiAgentStage, runDeterministicBuilderCommand)
 */

class WorkflowBrain {
  constructor(config = {}) {
    // External function dependencies (injected during initialization)
    this.setAiAgentStage = config.setAiAgentStage || (() => {});
    this.runDeterministicBuilderCommand =
      config.runDeterministicBuilderCommand || (() => null);
    this.getCanvasElement =
      config.getCanvasElement || (() => document.getElementById("web-canvas"));
  }

  /**
   * Extract color from user input
   * Supports named colors, hex codes, rgb(), etc.
   */
  extractColorFromPrompt(prompt = "", fallback = "#3b82f6") {
    const text = String(prompt || "").toLowerCase();
    const colorMap = {
      blue: "#3b82f6",
      red: "#ef4444",
      green: "#22c55e",
      yellow: "#eab308",
      orange: "#f97316",
      purple: "#a855f7",
      pink: "#ec4899",
      cyan: "#06b6d4",
      teal: "#14b8a6",
      white: "#ffffff",
      black: "#111827",
      gray: "#6b7280",
      grey: "#6b7280",
    };
    for (const key of Object.keys(colorMap)) {
      if (text.includes(key)) return colorMap[key];
    }
    const hex = text.match(/#([0-9a-f]{3}|[0-9a-f]{6})\b/i);
    if (hex) return `#${hex[1]}`;
    return fallback;
  }

  /**
   * Analyze user input to extract shape, animations, colors, effects, etc.
   * Used for creative element generation like "bouncing neon ring with border left"
   */
  analyzeSmartInsertDescription(userInput) {
    const input = String(userInput || "")
      .toLowerCase()
      .trim();

    // Extract shape/type
    const shapeMatch = input.match(
      /\b(ring|circle|box|square|wave|line|dot|ball|card|container|shape)\b/,
    );
    const shape = shapeMatch ? shapeMatch[1] : "box";

    // Extract animations
    const animations = [];
    if (/bouncy|bounce|bouncing/.test(input)) animations.push("bounce");
    if (/spin|spinning|rotate|rotating|rotation/.test(input))
      animations.push("spin");
    if (/pulse|pulsing|pulsate/.test(input)) animations.push("pulse");
    if (/wave|waves|waving/.test(input)) animations.push("wave");
    if (/glow|glowing|glowEffect/.test(input)) animations.push("glow");
    if (/slide|sliding|slide/.test(input)) animations.push("slide");
    if (/fade|fading|fadeIn|fadeOut/.test(input)) animations.push("fade");
    if (/shake|shaking|tremor/.test(input)) animations.push("shake");
    if (/float|floating|hover/.test(input)) animations.push("float");

    // Extract colors - comprehensive color detection
    const colorMap = {
      neon: "neon",
      cyan: "#00FFFF",
      lime: "#00FF00",
      magenta: "#FF00FF",
      pink: "#FF1493",
      red: "#FF0000",
      blue: "#0066FF",
      purple: "#9500FF",
      orange: "#FF6600",
      yellow: "#FFD700",
      green: "#00CC00",
      white: "#FFFFFF",
      black: "#000000",
      gold: "#FFD700",
      silver: "#C0C0C0",
      gradient: "gradient",
      rainbow: "rainbow",
    };

    let color = "#0066FF"; // default blue
    for (const [keyword, colorValue] of Object.entries(colorMap)) {
      if (input.includes(keyword)) {
        color = colorValue;
        break;
      }
    }

    // Extract size
    let size = "medium"; // small, medium, large
    if (/\b(small|tiny|mini|xs)\b/.test(input)) size = "small";
    if (/\b(large|big|xl|huge)\b/.test(input)) size = "large";
    if (/\b(medium|md)\b/.test(input)) size = "medium";

    // Extract border info
    const borderMatch = input.match(
      /border\s+(left|right|top|bottom|all|none)?/,
    );
    const borderPosition = borderMatch ? borderMatch[1] || "all" : null;
    const hasBorder = /border|outline|stroke/.test(input);

    // Extract effects
    const effects = [];
    if (/shadow|glow|blur|effect/.test(input)) effects.push("shadow");
    if (/gradient/.test(input)) effects.push("gradient");
    if (/blur/.test(input)) effects.push("blur");
    if (/frosted|glass|transparent/.test(input)) effects.push("frosted");

    return {
      shape,
      animations,
      color,
      size,
      borderPosition,
      hasBorder,
      effects,
      originalInput: userInput,
    };
  }

  /**
   * Generate smart canvas element spec from analysis
   * Creates HTML/CSS/animations for dynamic elements
   */
  generateSmartCanvasElementSpec(analysis) {
    const {
      shape,
      animations,
      color,
      size,
      borderPosition,
      hasBorder,
      effects,
    } = analysis;

    // Size mappings
    const sizeMap = {
      small: { w: 80, h: 80, border: 2 },
      medium: { w: 150, h: 150, border: 3 },
      large: { w: 250, h: 250, border: 4 },
    };
    const dims = sizeMap[size] || sizeMap.medium;

    // Color value (handle neon gradient)
    let primaryColor = color;
    if (color === "neon") {
      primaryColor = "#00FFFF";
    }

    let html = "";
    let css = "";
    let animations_css = "";
    let label = `${analysis.originalInput}`;

    // Generate HTML based on shape
    if (shape === "ring" || shape === "circle") {
      const borderStyle = hasBorder
        ? `${dims.border}px solid ${primaryColor}`
        : "none";
      html = `<div class="smart-element smart-${shape}" style="
        width: ${dims.w}px;
        height: ${dims.h}px;
        border: ${borderStyle};
        border-radius: 50%;
        background: ${color === "gradient" ? `linear-gradient(135deg, ${primaryColor}, #FF1493)` : "transparent"};
        ${effects.includes("glow") ? `box-shadow: 0 0 30px ${primaryColor}, inset 0 0 30px rgba(0,255,255,0.3);` : ""}
        ${effects.includes("shadow") ? `box-shadow: 0 10px 30px rgba(0,0,0,0.3);` : ""}
      "></div>`;
    } else if (shape === "box" || shape === "square") {
      const borderStyle = hasBorder
        ? `${dims.border}px solid ${primaryColor}`
        : "1px solid rgba(0,0,0,0.1)";
      const borderLeft =
        borderPosition === "left"
          ? `${dims.border * 3}px solid ${primaryColor}`
          : "none";
      html = `<div class="smart-element smart-box" style="
        width: ${dims.w}px;
        height: ${dims.h}px;
        border: ${borderStyle};
        border-left: ${borderLeft};
        background: ${color === "gradient" ? `linear-gradient(135deg, ${primaryColor}33, ${primaryColor}11)` : `${primaryColor}11`};
        border-radius: ${effects.includes("frosted") ? "20px" : "8px"};
        ${effects.includes("glow") ? `box-shadow: 0 0 20px ${primaryColor}44;` : ""}
        ${effects.includes("shadow") ? `box-shadow: 0 10px 30px rgba(0,0,0,0.2);` : ""}
        ${effects.includes("blur") ? "backdrop-filter: blur(10px);" : ""}
      "></div>`;
    } else if (shape === "wave") {
      html = `<svg class="smart-element smart-wave" width="${dims.w}" height="${dims.h}" viewBox="0 0 ${dims.w} ${dims.h}">
        <path d="M0,${dims.h / 2} Q${dims.w / 4},${dims.h / 4} ${dims.w / 2},${dims.h / 2} T${dims.w},${dims.h / 2}"
              stroke="${primaryColor}" stroke-width="3" fill="none" stroke-linecap="round"/>
      </svg>`;
    } else if (shape === "dot" || shape === "ball") {
      html = `<div class="smart-element smart-dot" style="
        width: ${dims.w}px;
        height: ${dims.h}px;
        background: ${color === "gradient" ? `radial-gradient(circle at 30% 30%, ${primaryColor}, #FF1493)` : primaryColor};
        border-radius: 50%;
        ${effects.includes("glow") ? `box-shadow: 0 0 40px ${primaryColor}, 0 0 80px ${primaryColor}88;` : ""}
        ${effects.includes("shadow") ? `box-shadow: 0 15px 35px rgba(0,0,0,0.3);` : ""}
      "></div>`;
    } else {
      // Default: creative container
      html = `<div class="smart-element smart-custom" style="
        width: ${dims.w}px;
        height: ${dims.h}px;
        background: ${color === "gradient" ? `linear-gradient(45deg, ${primaryColor}, #FF1493, ${primaryColor})` : `${primaryColor}22`};
        border: 2px dashed ${primaryColor};
        border-radius: 12px;
        display: flex;
        align-items: center;
        justify-content: center;
        color: ${primaryColor};
        font-weight: bold;
        font-size: 12px;
      ">Custom Element</div>`;
    }

    // Generate animations CSS
    const animationNames = [];
    if (animations.includes("bounce")) {
      animationNames.push("smartBounce");
      animations_css += `@keyframes smartBounce {
        0%, 100% { transform: translateY(0); }
        50% { transform: translateY(-20px); }
      }`;
    }
    if (animations.includes("spin")) {
      animationNames.push("smartSpin");
      animations_css += `@keyframes smartSpin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }`;
    }
    if (animations.includes("pulse")) {
      animationNames.push("smartPulse");
      animations_css += `@keyframes smartPulse {
        0%, 100% { opacity: 1; transform: scale(1); }
        50% { opacity: 0.7; transform: scale(1.1); }
      }`;
    }
    if (animations.includes("glow")) {
      animationNames.push("smartGlow");
      animations_css += `@keyframes smartGlow {
        0%, 100% { filter: brightness(1); }
        50% { filter: brightness(1.3); }
      }`;
    }
    if (animations.includes("float")) {
      animationNames.push("smartFloat");
      animations_css += `@keyframes smartFloat {
        0%, 100% { transform: translateY(0px); }
        50% { transform: translateY(-15px); }
      }`;
    }
    if (animations.includes("shake")) {
      animationNames.push("smartShake");
      animations_css += `@keyframes smartShake {
        0%, 100% { transform: translateX(0); }
        25% { transform: translateX(-5px); }
        75% { transform: translateX(5px); }
      }`;
    }
    if (animations.includes("slide")) {
      animationNames.push("smartSlide");
      animations_css += `@keyframes smartSlide {
        0% { transform: translateX(-100%); }
        100% { transform: translateX(100%); }
      }`;
    }
    if (animations.includes("fade")) {
      animationNames.push("smartFade");
      animations_css += `@keyframes smartFade {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.3; }
      }`;
    }

    if (animationNames.length > 0) {
      const animDuration = animations.includes("bounce") ? "1s" : "2s";
      css += `.smart-element { animation: ${animationNames.join(", ")} ${animDuration} infinite ease-in-out; }`;
    }

    return {
      type: "div",
      label: label,
      html: html,
      css: css,
      animations: animations_css,
      styles: {
        width: `${dims.w}px`,
        height: `${dims.h}px`,
        position: "relative",
        cursor: "grab",
      },
    };
  }

  /**
   * Analyze if user is requesting background changes
   * "make body green", "cat picture", etc.
   */
  analyzeBackgroundRequest(userInput) {
    const input = String(userInput || "")
      .toLowerCase()
      .trim();

    // Check if user is requesting body/page background changes
    const isBackgroundRequest =
      /\b(body|page|background|bg|set)\b/.test(input) &&
      (/background|bg|color|picture|image|photo|theme/.test(input) ||
        /make.*(?:my|the)?\s*(body|page|background)/.test(input));

    if (!isBackgroundRequest) return null;

    // Check if requesting image/picture background
    const isImageRequest =
      /\b(picture|photo|image|pic|wallpaper|unsplash)\b/.test(input) ||
      !/\b(color|solid|rgb|hex|#)\b/.test(input);

    // Extract search query for images (e.g., "cat picture" → "cat")
    let imageSearchQuery = null;
    if (isImageRequest) {
      const imageMatch = input.match(
        /(?:set|make|add|background|picture|image|photo)?\s+([a-z\s]+?)(?:\s+(?:background|picture|photo|image|wallpaper))?$/i,
      );
      if (imageMatch) {
        imageSearchQuery = imageMatch[1]
          .replace(/^(?:my|the|a|an)\s+/, "")
          .replace(/\b(?:background|bg|picture|photo|image)\b/g, "")
          .trim();
      }
    }

    // Extract color if specified
    let colorValue = null;
    const colorMap = {
      red: "#FF0000",
      blue: "#0066FF",
      green: "#00CC00",
      yellow: "#FFD700",
      purple: "#9500FF",
      pink: "#FF1493",
      orange: "#FF6600",
      cyan: "#00FFFF",
      lime: "#00FF00",
      white: "#FFFFFF",
      black: "#000000",
      gray: "#808080",
      grey: "#808080",
      gold: "#FFD700",
      silver: "#C0C0C0",
      teal: "#008080",
      indigo: "#4B0082",
      navy: "#000080",
      maroon: "#800000",
      khaki: "#F0E68C",
      salmon: "#FA8072",
      coral: "#FF7F50",
      turquoise: "#40E0D0",
    };

    for (const [keyword, hex] of Object.entries(colorMap)) {
      if (input.includes(keyword)) {
        colorValue = hex;
        break;
      }
    }

    // Check for hex or rgb colors
    const hexMatch = input.match(/#([0-9A-Fa-f]{6})/);
    if (hexMatch) colorValue = "#" + hexMatch[1];

    const rgbMatch = input.match(
      /rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/,
    );
    if (rgbMatch) {
      const r = parseInt(rgbMatch[1]);
      const g = parseInt(rgbMatch[2]);
      const b = parseInt(rgbMatch[3]);
      colorValue = `rgb(${r}, ${g}, ${b})`;
    }

    return {
      isBackgroundRequest: true,
      isImageRequest: isImageRequest && !!imageSearchQuery,
      colorValue: colorValue,
      imageSearchQuery: imageSearchQuery,
      originalInput: userInput,
    };
  }

  /**
   * Apply background change to canvas
   * Handles both solid colors and Unsplash images
   */
  applyBackgroundChange(analysis) {
    const canvas = this.getCanvasElement() || document.body;

    if (analysis.isImageRequest && analysis.imageSearchQuery) {
      // Use Unsplash API to fetch real image
      const searchQuery = encodeURIComponent(analysis.imageSearchQuery);
      const imageUrl = `https://source.unsplash.com/1920x1080/?${searchQuery}`;

      canvas.style.backgroundImage = `url('${imageUrl}')`;
      canvas.style.backgroundSize = "cover";
      canvas.style.backgroundPosition = "center";
      canvas.style.backgroundAttachment = "fixed";
      canvas.style.backgroundRepeat = "no-repeat";

      return {
        success: true,
        message: `✨ Canvas background set to "${analysis.imageSearchQuery}" image from Unsplash!`,
        action: `BACKGROUND_IMAGE ${analysis.imageSearchQuery}`,
      };
    } else if (analysis.colorValue) {
      // Set solid color background
      canvas.style.backgroundColor = analysis.colorValue;
      canvas.style.backgroundImage = "none";

      return {
        success: true,
        message: `✨ Canvas background changed to ${analysis.colorValue}!`,
        action: `BACKGROUND_COLOR ${analysis.colorValue}`,
      };
    }

    return null;
  }

  /**
   * Detect if user input is an insert intent
   * Handles misspellings, casual English, different phrasing
   */
  detectInsertIntent(userInput = "") {
    const text = String(userInput || "")
      .toLowerCase()
      .trim();
    if (!text) return false;

    // Insert intent keywords (covers misspellings, casual English, different phrasing)
    const intentPatterns = [
      /\b(insert|add|create|make|put|place|build|design|generate|render|draw|show|display|give me|fetch|produce|craft|construct|arrange|set|setup|get)\b/i,
      /\b(a|an|one|some)\s+(button|card|input|slider|toggle|spinner|modal|form|text|heading|image|circle|ball|box|container|element)\b/i,
      /^(can you|could you|please|would you|can i|give|put|show|insert|add|create)/i,
    ];

    return intentPatterns.some((pattern) => pattern.test(text));
  }

  /**
   * Normalize insert command to clean format
   * Removes filler words, extracts element type and styling
   */
  normalizeInsertCommand(userInput = "") {
    const text = String(userInput || "")
      .toLowerCase()
      .trim();

    // Remove common filler words and clean up
    let cleaned = text
      .replace(
        /^(can you|could you|please|would you|i want|give me|show me|put|place|create)\s+/gi,
        "",
      )
      .replace(/^(a|an)\s+/gi, "")
      .replace(/\bwhich\s+is\b/gi, "with")
      .replace(/\bmaybe\b/gi, "")
      .replace(/\badd\b/gi, "insert")
      .replace(/\bcould|can|please|would|i want\b/gi, "")
      .replace(/\s+and\s+(maybe|also|plus)\s+/gi, " with ")
      .replace(/\s+etc\.?$/gi, "")
      .replace(/[?!]+$/gi, "")
      .replace(/\s+/g, " ")
      .trim();

    // Extract element type
    const elementMatch = cleaned.match(
      /\b(button|card|input|field|slider|toggle|spinner|modal|form|text|heading|title|h\d|label|image|photo|picture|circle|ball|dot|sphere|box|container|div|section|header|footer|navbar|menu|dropdown|tab|badge|tag|chip|alert|tooltip|popover|calendar|date|time|color|checkbox|radio|select|textarea|search|pagination|breadcrumb)\b/i,
    );
    const elementType = elementMatch
      ? elementMatch[1].toLowerCase()
      : "element";

    // Extract styling description
    const styleDescriptors = [
      cleaned.match(
        /\b(red|blue|green|cyan|pink|purple|orange|yellow|white|black|gray|navy|magenta|lime|teal|gold|silver)\b/gi,
      ),
      cleaned.match(
        /\b(glow|shadow|gradient|rounded|round|border|blur|frosted|glass|glint|neon|sparkle|shimmer)\b/gi,
      ),
      cleaned.match(/\b(tiny|small|medium|large|huge|big|xl|2xl|3xl)\b/gi),
      cleaned.match(
        /\b(spin|bounce|pulse|float|wave|shake|animate|animation)\b/gi,
      ),
    ]
      .filter(Boolean)
      .flat();

    // Build normalized command
    const parts = ["insert", elementType];
    if (styleDescriptors.length > 0) {
      parts.push("with", styleDescriptors.join(" "));
    }

    let normalized = parts.filter(Boolean).join(" ");

    // Fallback: if detection failed, return original insight
    if (!normalized.includes("insert")) {
      normalized = `insert ${cleaned}`;
    }

    return normalized;
  }

  /**
   * Process smart insert command
   * Detects intent, normalizes, and executes
   */
  async processSmartInsertCommand(userInput = "") {
    const text = String(userInput || "").trim();

    // First check: is this an insert-related command?
    const isInsertIntent = this.detectInsertIntent(text);
    if (!isInsertIntent) {
      return null; // Not an insert command, return to normal chat
    }

    // Normalize the command to clean format
    const normalized = this.normalizeInsertCommand(text);

    // Try to execute normalized command through deterministic handler
    this.setAiAgentStage("parsing");
    const result = this.runDeterministicBuilderCommand(normalized);

    if (result?.applied) {
      return {
        success: true,
        normalized,
        message: result.message || "Element inserted successfully",
        applied: result.applied,
        actions: result.actions,
      };
    }

    // If deterministic failed, return normalized command for AI processing
    return {
      success: false,
      normalized,
      message: "Normalized command - will use AI agent",
      requiresAI: true,
    };
  }

  /**
   * Get all expanded element types (reference)
   */
  getExpandedElementTypes() {
    return {
      // Basic elements
      button: { type: "button", label: "button", defaultText: "Click Me" },
      text: { type: "text", label: "text" },
      heading: { type: "text", label: "heading", defaultText: "Heading" },
      title: { type: "text", label: "title", defaultText: "Title" },
      label: { type: "text", label: "label", defaultText: "Label" },
      image: { type: "img", label: "image" },
      photo: { type: "img", label: "photo" },
      picture: { type: "img", label: "picture" },
      input: { type: "input", label: "input field" },
      field: { type: "input", label: "input field" },
      textarea: { type: "textarea", label: "textarea" },

      // Interactive elements
      slider: { type: "div", label: "slider", class: "ml-slider-element" },
      toggle: { type: "div", label: "toggle", class: "ml-toggle-element" },
      spinner: { type: "div", label: "spinner", class: "ml-spinner-element" },
      switch: { type: "div", label: "switch", class: "ml-switch-element" },
      checkbox: {
        type: "input",
        label: "checkbox",
        attrs: { type: "checkbox" },
      },
      radio: { type: "input", label: "radio", attrs: { type: "radio" } },
      select: { type: "select", label: "dropdown" },
      dropdown: { type: "select", label: "dropdown" },

      // Container elements
      card: { type: "div", label: "card", class: "ml-card-element" },
      box: { type: "div", label: "box", class: "ml-box-element" },
      container: {
        type: "div",
        label: "container",
        class: "ml-container-element",
      },
      section: { type: "section", label: "section" },
      modal: { type: "div", label: "modal", class: "ml-modal-element" },
      dialog: { type: "div", label: "dialog", class: "ml-dialog-element" },
      panel: { type: "div", label: "panel", class: "ml-panel-element" },

      // Shape elements
      circle: { type: "div", label: "circle", class: "ml-circle-element" },
      ball: { type: "div", label: "ball", class: "ml-circle-element" },
      dot: { type: "div", label: "dot", class: "ml-dot-element" },
      sphere: { type: "div", label: "sphere", class: "ml-sphere-element" },

      // UI components
      badge: { type: "span", label: "badge", class: "ml-badge-element" },
      tag: { type: "span", label: "tag", class: "ml-tag-element" },
      chip: { type: "span", label: "chip", class: "ml-chip-element" },
      alert: { type: "div", label: "alert", class: "ml-alert-element" },
      tooltip: { type: "div", label: "tooltip", class: "ml-tooltip-element" },
      popover: { type: "div", label: "popover", class: "ml-popover-element" },
      menu: { type: "nav", label: "menu", class: "ml-menu-element" },
      navbar: { type: "nav", label: "navbar", class: "ml-navbar-element" },
      pagination: {
        type: "div",
        label: "pagination",
        class: "ml-pagination-element",
      },
      breadcrumb: {
        type: "nav",
        label: "breadcrumb",
        class: "ml-breadcrumb-element",
      },
      tab: { type: "div", label: "tab", class: "ml-tab-element" },
      tabgroup: {
        type: "div",
        label: "tabgroup",
        class: "ml-tabgroup-element",
      },

      // Other elements
      form: { type: "form", label: "form", class: "ml-form-element" },
      search: {
        type: "input",
        label: "search",
        attrs: { type: "search", placeholder: "Search..." },
      },
      calendar: {
        type: "div",
        label: "calendar",
        class: "ml-calendar-element",
      },
      datepicker: {
        type: "input",
        label: "date picker",
        attrs: { type: "date" },
      },
      timepicker: {
        type: "input",
        label: "time picker",
        attrs: { type: "time" },
      },
      colorpicker: {
        type: "input",
        label: "color picker",
        attrs: { type: "color" },
      },
    };
  }
}

// Export for use in Node/Webpack environments
if (typeof module !== "undefined" && module.exports) {
  module.exports = WorkflowBrain;
}

// Make available globally in browser
if (typeof window !== "undefined") {
  window.WorkflowBrain = WorkflowBrain;
}
