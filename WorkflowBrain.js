/**
 * WorkflowBrain.js - Advanced Animation & Element Generation AI
 *
 * Core AI-powered insert, animation, and processing system for MediaLab
 * Handles intelligent element generation, complex animations, background detection, and command normalization
 *
 * Advanced Animation Capabilities:
 * - Neon rings with glowing effects
 * - Complex bounce, pulse, glow combinations
 * - Shimmer, wave, morph animations
 * - CSS keyframe generation from natural language
 * - Multi-effect composition
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

    // Advanced animation library
    this.animationLibrary = this.initializeAnimationLibrary();
  }

  /**
   * Initialize comprehensive animation effects library
   * Provides advanced CSS keyframes and effect compositions
   */
  initializeAnimationLibrary() {
    return {
      // Basic animations
      bounce: {
        keyframes: `@keyframes bounce {
          0%, 100% { transform: translateY(0) scale(1); }
          50% { transform: translateY(-25px) scale(1.05); }
        }`,
        duration: "0.8s",
        timingFunction: "cubic-bezier(0.68, -0.55, 0.265, 1.55)",
      },

      // Neon glow animation with intensity pulse
      neonGlow: {
        keyframes: `@keyframes neonGlow {
          0%, 100% { 
            filter: brightness(1) drop-shadow(0 0 5px currentColor);
            text-shadow: 0 0 10px rgba(0, 255, 255, 0.5);
          }
          50% { 
            filter: brightness(1.3) drop-shadow(0 0 15px currentColor);
            text-shadow: 0 0 20px rgba(0, 255, 255, 0.8), 0 0 30px rgba(0, 255, 255, 0.5);
          }
        }`,
        duration: "1.5s",
        timingFunction: "ease-in-out",
      },

      // Ring/circle neon effect with box-shadow glow
      neonRingGlow: {
        keyframes: `@keyframes neonRingGlow {
          0%, 100% { 
            box-shadow: 0 0 10px var(--glow-color, #00FFFF), 
                        inset 0 0 10px rgba(0, 255, 255, 0.2);
          }
          50% { 
            box-shadow: 0 0 20px var(--glow-color, #00FFFF),
                        0 0 30px var(--glow-color, #00FFFF),
                        inset 0 0 20px rgba(0, 255, 255, 0.4);
          }
        }`,
        duration: "1.5s",
        timingFunction: "ease-in-out",
      },

      // Complex bounce with glow composition
      bouncingGlow: {
        keyframes: `@keyframes bouncingGlow {
          0%, 100% { 
            transform: translateY(0) scale(1);
            filter: brightness(1);
          }
          50% { 
            transform: translateY(-30px) scale(1.08);
            filter: brightness(1.4);
          }
        }`,
        duration: "1s",
        timingFunction: "cubic-bezier(0.34, 1.56, 0.64, 0.58)",
      },

      // Shimmer effect (moving highlight)
      shimmer: {
        keyframes: `@keyframes shimmer {
          0% { background-position: -1000px 0; }
          100% { background-position: 1000px 0; }
        }`,
        duration: "3s",
        timingFunction: "linear",
      },

      // Pulsing glow (size + opacity)
      pulseGlow: {
        keyframes: `@keyframes pulseGlow {
          0%, 100% { 
            opacity: 0.7;
            transform: scale(1);
            filter: brightness(1);
          }
          50% { 
            opacity: 1;
            transform: scale(1.15);
            filter: brightness(1.3);
          }
        }`,
        duration: "2s",
        timingFunction: "ease-in-out",
      },

      // Wave/ripple effect
      waveRipple: {
        keyframes: `@keyframes waveRipple {
          0%, 100% { transform: scale(1); opacity: 0.8; }
          50% { transform: scale(1.2); opacity: 0.4; }
        }`,
        duration: "2s",
        timingFunction: "ease-in-out",
      },

      // Rotating glow (spin + brightness)
      rotatingGlow: {
        keyframes: `@keyframes rotatingGlow {
          0% { 
            transform: rotate(0deg);
            filter: brightness(1);
          }
          50% { 
            filter: brightness(1.3);
          }
          100% { 
            transform: rotate(360deg);
            filter: brightness(1);
          }
        }`,
        duration: "2s",
        timingFunction: "linear",
      },

      // Floating animation
      floating: {
        keyframes: `@keyframes floating {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-20px); }
        }`,
        duration: "3s",
        timingFunction: "ease-in-out",
      },

      // Shake effect
      shake: {
        keyframes: `@keyframes shake {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-10px); }
          75% { transform: translateX(10px); }
        }`,
        duration: "0.5s",
        timingFunction: "ease-in-out",
      },

      // Slide animation
      slide: {
        keyframes: `@keyframes slide {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }`,
        duration: "2s",
        timingFunction: "ease-in-out",
      },

      // Fade pulse
      fadePulse: {
        keyframes: `@keyframes fadePulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }`,
        duration: "2s",
        timingFunction: "ease-in-out",
      },

      // Morph animation (3D perspective)
      morph: {
        keyframes: `@keyframes morph {
          0%, 100% { 
            border-radius: 50%;
            transform: scale(1) rotateX(0deg);
          }
          50% { 
            border-radius: 20%;
            transform: scale(1.1) rotateX(180deg);
          }
        }`,
        duration: "3s",
        timingFunction: "ease-in-out",
      },
    };
  }

  /**
   * Parse complex animation descriptions and compose effects
   * "bouncing neon ring glowing" → combines bounce + neon-glow + ring-glow
   */
  parseAdvancedAnimation(description = "") {
    const desc = String(description || "").toLowerCase();
    const effects = [];

    // Detect animation keywords and map to library
    if (/bouncy|bounce|bouncing|jump|hopping/.test(desc)) {
      if (/glow|glowing|neon/.test(desc)) {
        effects.push("bouncingGlow");
      } else {
        effects.push("bounce");
      }
    }

    if (/neon|glow|glowing|light|bright|shine|shimmer/.test(desc)) {
      if (/ring/.test(desc) || /circle/.test(desc)) {
        effects.push("neonRingGlow");
      } else {
        effects.push("neonGlow");
      }
    }

    if (/pulse|pulsing|pulsate|throb/.test(desc)) {
      if (/glow|bright/.test(desc)) {
        effects.push("pulseGlow");
      } else {
        effects.push("fadePulse");
      }
    }

    if (/wave|ripple|water|ocean/.test(desc)) {
      effects.push("waveRipple");
    }

    if (/spin|rotate|rotating|rotation|twirl|whirl/.test(desc)) {
      if (/glow/.test(desc)) {
        effects.push("rotatingGlow");
      } else {
        effects.push("bounce"); // fallback
      }
    }

    if (/shimmer|glitter|sparkle/.test(desc)) {
      effects.push("shimmer");
    }

    if (/float|floating|hover|levitate|drift/.test(desc)) {
      effects.push("floating");
    }

    if (/shake|tremor|vibrate|jitter/.test(desc)) {
      effects.push("shake");
    }

    if (/slide|slide-in|slide-out/.test(desc)) {
      effects.push("slide");
    }

    if (/morph|transform|shape-shift/.test(desc)) {
      effects.push("morph");
    }

    // If no effects detected, default to bouncing glow for "complex" animations
    if (
      effects.length === 0 &&
      /complex|cool|awesome|crazy|advanced|pro/.test(desc)
    ) {
      effects.push("bouncingGlow");
    }

    return effects.length > 0 ? effects : ["bounce"];
  }

  /**
   * Generate CSS animations with composition support
   * Takes array of animation names and produces combined CSS
   */
  generateAnimationCSS(animationNames = [], customDuration = null) {
    let keyframes = "";
    const animations = [];

    for (const animName of animationNames) {
      const anim = this.animationLibrary[animName];
      if (anim) {
        keyframes += anim.keyframes + "\n";
        animations.push({
          name: animName,
          duration: customDuration || anim.duration,
          timing: anim.timingFunction,
        });
      }
    }

    // Compose animation property
    const animationStr = animations
      .map((a) => `${a.name} ${a.duration} ${a.timing} infinite`)
      .join(", ");

    return {
      keyframes,
      animation: animationStr,
    };
  }

  /**
   * Create neon ring element with advanced glow
   * Highly customizable neon effect for "bouncing neon ring" type requests
   */
  createNeonRing(options = {}) {
    const {
      size = 150,
      color = "#00FFFF",
      glowIntensity = 25,
      animations = ["neonRingGlow", "bouncingGlow"],
      thickness = 3,
      additionalEffects = [],
    } = options;

    const glowColor = color === "neon" ? "#00FFFF" : color;
    const innerRadius = (size - thickness * 2) / 2;

    // Generate animation CSS
    const { keyframes, animation } = this.generateAnimationCSS(animations);

    // Create SVG-based neon ring for crisp rendering
    const html = `<div class="neon-ring-container" style="
      width: ${size}px;
      height: ${size}px;
      position: relative;
      --glow-color: ${glowColor};
      animation: ${animation};
    ">
      <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="filter: blur(${additionalEffects.includes("blur") ? 0.5 : 0}px);">
        <circle 
          cx="${size / 2}" 
          cy="${size / 2}" 
          r="${size / 2 - thickness / 2}"
          fill="none"
          stroke="${glowColor}"
          stroke-width="${thickness}"
          opacity="0.9"
          style="filter: drop-shadow(0 0 ${glowIntensity}px ${glowColor});"
        />
      </svg>
    </div>`;

    return {
      type: "neon-ring",
      html,
      css: keyframes,
      animations,
      svgBased: true,
      style: {
        position: "relative",
        display: "inline-block",
      },
    };
  }

  /**
   * Create glowing sphere/ball with advanced effects
   * Perfect for "bouncing glowing neon ball"
   */
  createGlowingSphere(options = {}) {
    const {
      size = 100,
      color = "#00FFFF",
      glowIntensity = 30,
      animations = ["bouncingGlow"],
      innerGlow = true,
    } = options;

    const { keyframes, animation } = this.generateAnimationCSS(
      animations,
      "1s",
    );

    const html = `<div class="glowing-sphere" style="
      width: ${size}px;
      height: ${size}px;
      background: radial-gradient(circle at 35% 35%, ${color}, rgba(0, 255, 255, 0.3));
      border-radius: 50%;
      box-shadow: 
        0 0 ${glowIntensity}px ${color},
        ${innerGlow ? `inset 0 0 ${glowIntensity / 2}px rgba(255, 255, 255, 0.3),` : ""}
        0 0 ${glowIntensity * 2}px ${color}66;
      animation: ${animation};
      position: relative;
      cursor: grab;
    "></div>`;

    return {
      type: "glowing-sphere",
      html,
      css: keyframes,
      animations,
      simple: true,
    };
  }

  /**
   * Extract color from user input
   * Supports named colors, hex codes, rgb(), neon colors, gradients
   */
  extractColorFromPrompt(prompt = "", fallback = "#3b82f6") {
    const text = String(prompt || "").toLowerCase();
    const colorMap = {
      neon: "#00FFFF",
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
      teal: "#008080",
      indigo: "#4B0082",
      navy: "#000080",
      maroon: "#800000",
      khaki: "#F0E68C",
      salmon: "#FA8072",
      coral: "#FF7F50",
      turquoise: "#40E0D0",
      violet: "#EE82EE",
      scarlet: "#FF2400",
      crimson: "#DC143C",
    };

    for (const [keyword, colorValue] of Object.entries(colorMap)) {
      if (text.includes(keyword)) return colorValue;
    }

    const hex = text.match(/#([0-9a-f]{3}|[0-9a-f]{6})\b/i);
    if (hex) return `#${hex[1]}`;

    const rgbMatch = text.match(
      /rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/,
    );
    if (rgbMatch) {
      const r = parseInt(rgbMatch[1]);
      const g = parseInt(rgbMatch[2]);
      const b = parseInt(rgbMatch[3]);
      return `rgb(${r}, ${g}, ${b})`;
    }

    return fallback;
  }

  /**
   * Analyze user input to extract shape, animations, colors, effects, etc.
   * Used for creative element generation like "bouncing neon ring with border left"
   */
  /**
   * Analyze user input to extract shape, animations, colors, effects, etc.
   * Uses advanced animation parsing for "bouncing neon ring with border left" type requests
   * Enhanced to handle natural variations: "red button", "outline at left and right", etc.
   */
  analyzeSmartInsertDescription(userInput) {
    const input = String(userInput || "")
      .toLowerCase()
      .trim();

    // Extract shape/type with better support for common shape references
    const shapeMatch = input.match(
      /\b(button|ring|circle|round|rounded|box|square|wave|line|dot|ball|card|container|shape|sphere|neon|bubble)\b/,
    );
    let shape = shapeMatch ? shapeMatch[1] : "box";

    // Normalize shape references
    if (shape === "button") shape = "box"; // buttons are typically box-shaped
    if (shape === "round" || shape === "rounded") shape = "circle"; // round = circle

    // Use advanced animation parser for complex animations
    const animations = this.parseAdvancedAnimation(input);

    // Extract color - comprehensive detection
    const color = this.extractColorFromPrompt(input, "#0066FF");

    // Extract size
    let size = "medium"; // small, medium, large
    if (/\b(small|tiny|mini|xs)\b/.test(input)) size = "small";
    if (/\b(large|big|xl|huge|enormous|massive)\b/.test(input)) size = "large";
    if (/\b(medium|md)\b/.test(input)) size = "medium";

    // Enhanced border extraction that handles "outline at left and right"
    let borderPosition = null;
    const hasBorder = /border|outline|stroke|edge/.test(input);

    if (hasBorder) {
      // Check for specific sides mentioned with border/outline
      const sides = [];
      if (
        /\b(?:outline|border).*\bleft\b|\bleft\b.*(?:outline|border)/i.test(
          input,
        )
      )
        sides.push("left");
      if (
        /\b(?:outline|border).*\bright\b|\bright\b.*(?:outline|border)/i.test(
          input,
        )
      )
        sides.push("right");
      if (
        /\b(?:outline|border).*\btop\b(?![\s\w]*canvas)|\btop\b(?:[\s+side\s]*|[\s+at\s]*|[\s+outline\s]*|[\s+border\s]*)/i.test(
          input,
        ) &&
        !/top\s+of\s+(?:the\s+)?(?:canvas|page)/i.test(input)
      )
        sides.push("top");
      if (
        /\b(?:outline|border).*\bbottom\b|\bbottom\b.*(?:outline|border)/i.test(
          input,
        )
      )
        sides.push("bottom");

      // Use sides if found, otherwise default to "all"
      if (sides.length > 0) {
        borderPosition = sides.length === 1 ? sides[0] : sides.join("_");
      } else {
        borderPosition = "all";
      }
    }

    // Extract effects with advanced support
    const effects = [];
    if (/shadow|shade|dark/.test(input)) effects.push("shadow");
    if (/gradient|linear|radial/.test(input)) effects.push("gradient");
    if (/blur|hazy|soft/.test(input)) effects.push("blur");
    if (/frosted|glass|transparent|translucent/.test(input))
      effects.push("frosted");
    if (/neon|glow|bright|shine|luminous/.test(input)) effects.push("glow");

    // Detect if complex animation is requested (for behavior tuning)
    const isComplex =
      /complex|pro|crazy|advanced|cool|awesome|epic|boss/.test(input) &&
      animations.length > 1;

    return {
      shape,
      animations,
      color,
      size,
      borderPosition,
      hasBorder,
      effects,
      isComplex,
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

    // CHECK FOR ADVANCED ANIMATIONS (from parseAdvancedAnimation) and use generateAnimationCSS
    const hasAdvancedAnimations = animations.some(
      (anim) => this.animationLibrary && this.animationLibrary[anim],
    );

    if (hasAdvancedAnimations) {
      // Use the advanced animation generator for professional animations
      const { keyframes: advKeyframes, animation: advAnimation } =
        this.generateAnimationCSS(animations);
      if (advKeyframes) {
        animations_css = advKeyframes;
      }
      if (advAnimation) {
        // Apply animation to smart-element class
        css = `.smart-element { animation: ${advAnimation}; }\n` + css;
      }
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
   * Extract text content from natural language command
   * Handles: "with text saying click me", "button 'click me'", quoted text, etc.
   */
  extractTextFromCommand(userInput) {
    const text = String(userInput || "").toLowerCase();

    // Check for quoted text: "button 'Click Me'" or 'button "Submit"'
    const quotedMatch = text.match(/['"`]([^'"`]+)['"`]/);
    if (quotedMatch) {
      return quotedMatch[1].trim();
    }

    // Check for "saying text": "with text saying click me"
    const sayingMatch = text.match(
      /(?:saying|says|with text)\s+([a-z\s]+?)(?:\s+and|\s+with|$)/i,
    );
    if (sayingMatch) {
      return sayingMatch[1].trim();
    }

    // Check for "text: something": "button text: Submit"
    const colonMatch = text.match(/text:?\s+([a-z\s]+?)(?:\s+and|\s+with|$)/i);
    if (colonMatch) {
      return colonMatch[1].trim();
    }

    return null;
  }

  /**
   * Parse position keywords from natural language
   * "top", "bottom", "left", "right", "top-left", "center", etc.
   */
  extractPositionFromCommand(userInput) {
    const text = String(userInput || "").toLowerCase();

    // Check for canvas/body positioning
    const positionKeywords = {
      "top-left": { x: "5%", y: "5%" },
      "top-center": { x: "50%", y: "5%" },
      "top-right": { x: "95%", y: "5%" },
      "middle-left": { x: "5%", y: "50%" },
      center: { x: "50%", y: "50%" },
      "middle-right": { x: "95%", y: "50%" },
      "bottom-left": { x: "5%", y: "90%" },
      "bottom-center": { x: "50%", y: "90%" },
      "bottom-right": { x: "95%", y: "90%" },
      top: { x: "50%", y: "5%" },
      bottom: { x: "50%", y: "90%" },
      left: { x: "5%", y: "50%" },
      right: { x: "95%", y: "50%" },
    };

    for (const [keyword, position] of Object.entries(positionKeywords)) {
      const regex = new RegExp(
        `(?:place|put|at|position|top of|bottom of|left of|right of|center of|middle of)?\\s+${keyword}`,
        "i",
      );
      if (regex.test(text)) {
        return { position: keyword, ...position };
      }
    }

    // Default: center
    return { position: "center", x: "50%", y: "50%" };
  }

  /**
   * Parse border/outline specifications
   * "left and top outline", "border all sides", etc.
   */
  extractBorderFromCommand(userInput) {
    const text = String(userInput || "").toLowerCase();

    const borderConfig = {
      sides: [],
      width: 2,
      style: "solid",
    };

    // Check for specific sides
    if (
      /\bleft\b.*(?:border|outline)|\b(?:border|outline).*\bleft\b/i.test(text)
    )
      borderConfig.sides.push("left");
    if (
      /\bright\b.*(?:border|outline)|\b(?:border|outline).*\bright\b/i.test(
        text,
      )
    )
      borderConfig.sides.push("right");
    if (/\btop\b.*(?:border|outline)|\b(?:border|outline).*\btop\b/i.test(text))
      borderConfig.sides.push("top");
    if (
      /\bbottom\b.*(?:border|outline)|\b(?:border|outline).*\bbottom\b/i.test(
        text,
      )
    )
      borderConfig.sides.push("bottom");

    // If specific sides mentioned, keep them; otherwise check for "all"
    if (borderConfig.sides.length === 0) {
      if (/\bborder\b|\boutline\b|\bedge\b/i.test(text)) {
        borderConfig.sides = ["all"];
      }
    }

    // Check for width specifications
    if (/\bthick\b/) borderConfig.width = 4;
    if (/\bthion|thin\b/) borderConfig.width = 1;
    if (/\b(\d+)\s*px\s*(?:border|outline)/)
      borderConfig.width = parseInt(RegExp.$1);

    return borderConfig;
  }

  /**
   * Parse size modifiers from natural language
   * "slightly bigger", "a bit larger", "way bigger", etc.
   */
  extractSizeModifierFromCommand(userInput) {
    const text = String(userInput || "").toLowerCase();

    // Start with default "medium"
    let sizeCategory = "medium";

    // Check for size keywords
    if (/\b(?:tiny|mini|x?small)\b/) sizeCategory = "small";
    if (/\b(?:large|big|x?large|xl|huge|enormous)\b/) sizeCategory = "large";
    if (/\bmedium|md\b/) sizeCategory = "medium";

    // Check for modifiers
    let sizeMultiplier = 1.0;
    if (/\bslightly\s+(?:bigger|larger)/) sizeMultiplier = 1.15;
    if (/\ba\s+bit\s+(?:bigger|larger)/) sizeMultiplier = 1.2;
    if (/\bquite\s+(?:bigger|larger)/) sizeMultiplier = 1.4;
    if (/\bmuch\s+(?:bigger|larger)|\bway\s+(?:bigger|larger)/)
      sizeMultiplier = 1.6;
    if (/\bslightly\s+(?:smaller|smaller)/) sizeMultiplier = 0.85;
    if (/\ba\s+bit\s+(?:smaller|smaller)/) sizeMultiplier = 0.8;

    return { sizeCategory, sizeMultiplier };
  }

  /**
   * Parse natural command for comprehensive element specification
   * Handles: "drop a button with left and top outline slightly bigger and yellow with text saying click me at top of canvas"
   */
  parseNaturalCommand(userInput) {
    const input = String(userInput || "")
      .toLowerCase()
      .trim();

    // Extract element type
    const elementMatch = input.match(
      /\b(button|input|text|link|card|box|container|div|section|image|heading|label|form)\b/i,
    );
    const elementType = elementMatch ? elementMatch[1].toLowerCase() : "button";

    // Extract text content (for buttons, headings, etc.)
    const textContent = this.extractTextFromCommand(input);

    // Extract styling
    const color = this.extractColorFromPrompt(input, "#3b82f6");
    const { sizeCategory, sizeMultiplier } =
      this.extractSizeModifierFromCommand(input);

    // Extract border/outline
    const borderInfo = this.extractBorderFromCommand(input);

    // Extract positioning
    const positionInfo = this.extractPositionFromCommand(input);

    // Extract animations
    const animations = this.parseAdvancedAnimation(input);

    return {
      elementType,
      textContent,
      color,
      sizeCategory,
      sizeMultiplier,
      borderInfo,
      positionInfo,
      animations,
      originalInput: userInput,
    };
  }

  /**
   * Generate natural element spec with all details
   * Creates button with text, specific outline sides, position, size, color
   */
  generateNaturalElementSpec(naturalParsed) {
    const {
      elementType,
      textContent,
      color,
      sizeCategory,
      sizeMultiplier,
      borderInfo,
      positionInfo,
    } = naturalParsed;

    // Size base mappings
    const sizeMap = {
      small: { w: 80, h: 40 },
      medium: { w: 120, h: 50 },
      large: { w: 200, h: 70 },
    };

    let baseSize = sizeMap[sizeCategory] || sizeMap.medium;
    const w = Math.round(baseSize.w * sizeMultiplier);
    const h = Math.round(baseSize.h * sizeMultiplier);

    // Build border CSS
    let borderCSS = "";
    if (borderInfo.sides.length > 0) {
      const borderWidth = borderInfo.width;
      const borderStyle = borderInfo.style;
      const borderColor = color === "gradient" ? "#3b82f6" : color;

      if (borderInfo.sides.includes("all")) {
        borderCSS = `border: ${borderWidth}px ${borderStyle} ${borderColor};`;
      } else {
        borderInfo.sides.forEach((side) => {
          borderCSS += `border-${side}: ${borderWidth}px ${borderStyle} ${borderColor};`;
        });
      }
    }

    // Position calculation (convert percentages to pixels for canvas)
    // Assuming 1200x700 canvas (typical)
    const canvasW = 1200;
    const canvasH = 700;
    let left = canvasW * 0.5 - w / 2; // center x
    let top = canvasH * 0.5 - h / 2; // center y

    if (positionInfo.x && positionInfo.x.includes("%")) {
      left = (canvasW * parseInt(positionInfo.x)) / 100 - w / 2;
    }
    if (positionInfo.y && positionInfo.y.includes("%")) {
      top = (canvasH * parseInt(positionInfo.y)) / 100 - h / 2;
    }

    // Generate HTML based on element type
    let html = "";
    const btnText = textContent || "Click Me";

    if (elementType === "button" || elementType === "link") {
      html = `<button class="natural-element" style="
        width: ${w}px;
        height: ${h}px;
        background-color: ${color === "gradient" ? "#3b82f6" : color};
        color: white;
        font-weight: bold;
        font-size: 14px;
        padding: 10px;
        cursor: pointer;
        border-radius: 4px;
        ${borderCSS}
      ">${btnText}</button>`;
    } else if (elementType === "text" || elementType === "heading") {
      html = `<div class="natural-element" style="
        width: ${w}px;
        height: ${h}px;
        color: ${color};
        font-weight: bold;
        font-size: 16px;
        display: flex;
        align-items: center;
        justify-content: center;
        ${borderCSS}
      ">${btnText}</div>`;
    } else {
      html = `<div class="natural-element" style="
        width: ${w}px;
        height: ${h}px;
        background-color: ${color === "gradient" ? "linear-gradient(135deg, #3b82f6, #8b5cf6)" : color};
        ${borderCSS}
      "></div>`;
    }

    // Generate CSS for animations if any
    let css = "";
    let animations_css = "";
    if (naturalParsed.animations && naturalParsed.animations.length > 0) {
      const { keyframes, animation } = this.generateAnimationCSS(
        naturalParsed.animations,
      );
      if (keyframes) animations_css = keyframes;
      if (animation) css = `.natural-element { animation: ${animation}; }`;
    }

    return {
      type: "div",
      label: `${elementType} with text "${btnText}"`,
      html,
      css,
      animations: animations_css,
      styles: {
        width: `${w}px`,
        height: `${h}px`,
        position: "absolute",
        left: `${Math.round(left)}px`,
        top: `${Math.round(top)}px`,
      },
    };
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
   * Detect if user input is an insert/element creation intent
   * Returns confidence level for intent detection
   */
  detectInsertIntent(userInput = "") {
    const text = String(userInput || "").toLowerCase();

    // Strong insert intent keywords
    const strongIntentPatterns = [
      /\b(insert|add|drop|place|create|make)\s+(?:a|an|the)?\s*\b(button|input|text|card|box|circle|image|heading|form|modal)\b/,
      /\b(button|box|card|circle|shape|element)\b.*\b(with|and|having|using)\b/,
      /\b(put|place).*\b(button|box|text|element|shape)\b/,
      /bouncing|neon|glowing|animated.*(?:button|box|circle|element)/,
    ];

    // Medium intent patterns (partial matches)
    const mediumIntentPatterns = [
      /\b(with|add|insert).*\b(text|color|border|animation|glow)\b/,
      /\b(button|link|input|field|card|box|container)\b.*\b(text|saying|labeled)\b/,
      /\b(drop|create).*(?:element|component|widget)\b/,
    ];

    // Element type detection
    const elementTypes = [
      "button",
      "card",
      "input",
      "field",
      "slider",
      "toggle",
      "spinner",
      "modal",
      "form",
      "text",
      "heading",
      "title",
      "label",
      "image",
      "circle",
      "ball",
      "dot",
      "sphere",
      "box",
      "container",
      "div",
      "section",
      "badge",
      "tag",
      "chip",
      "alert",
      "tooltip",
      "navbar",
      "link",
      "search",
      "dropdown",
      "select",
      "checkbox",
      "radio",
    ];
    const hasElementType = elementTypes.some((type) =>
      new RegExp(`\\b${type}\\b`, "i").test(text),
    );

    // Animation/style keywords that suggest element creation
    const styleKeywords = [
      "glow",
      "bounce",
      "neon",
      "shadow",
      "gradient",
      "animation",
      "animate",
      "border",
      "color",
      "brighter",
      "with text",
      "saying",
      "glowing",
      "bouncing",
      "rotating",
      "pulsing",
    ];
    const hasStyleKeywords = styleKeywords.some((keyword) =>
      text.includes(keyword),
    );

    // Strong intent = very confident
    for (const pattern of strongIntentPatterns) {
      if (pattern.test(text)) {
        return {
          isIntent: true,
          confidence: 0.95,
          type: "strong",
        };
      }
    }

    // Medium intent = confident + element type
    for (const pattern of mediumIntentPatterns) {
      if (pattern.test(text) && hasElementType) {
        return {
          isIntent: true,
          confidence: 0.75,
          type: "medium",
        };
      }
    }

    // Element type + style = probable intent
    if (hasElementType && hasStyleKeywords) {
      return {
        isIntent: true,
        confidence: 0.7,
        type: "probable",
      };
    }

    // Standalone element type mentions
    if (hasElementType) {
      return {
        isIntent: true,
        confidence: 0.5,
        type: "weak",
      };
    }

    return {
      isIntent: false,
      confidence: 0,
      type: "none",
    };
  }

  /**
   * Parse natural language intent with detailed command extraction
   * Handles multi-intent commands and provides semantic understanding
   */
  parseNaturalLanguageIntent(userInput = "") {
    const text = String(userInput || "").toLowerCase();

    // Detect multiple intent types
    const intents = {
      insert: /\b(insert|add|drop|place|create|make)\b/,
      modify: /\b(change|update|edit|modify|adjust|set)\b/,
      background: /\b(background|bg|body|page)\b/,
      animate: /\b(animate|animation|bounce|glow|pulse|spin|rotate)\b/,
      position: /\b(top|bottom|left|right|center|position|place|at|move)\b/,
      color: /\b(color|colored|colored|tint|hue)\b/,
      text: /\b(text|saying|labeled|with name|titled)\b/,
      size: /\b(big|small|large|tiny|huge|medium|xl|xs)\b/,
      special: /\b(glow|neon|shadow|gradient|blur|frosted|glass)\b/,
    };

    // Extract detected intents
    const detectedIntents = Object.entries(intents)
      .filter(([key, pattern]) => pattern.test(text))
      .map(([key]) => key);

    // Extract semantic values
    const semantic = {
      elementType: this.extractElementType(text),
      colors: this.extractAllColors(text),
      animations: this.parseAdvancedAnimation(text),
      position: this.extractPositionFromCommand(text),
      textContent: this.extractTextFromCommand(text),
      size: this.extractSizeModifierFromCommand(text),
      specialEffects: this.extractSpecialEffects(text),
      borderInfo: this.extractBorderFromCommand(text),
    };

    return {
      originalInput: userInput,
      detectedIntents,
      primaryIntent: detectedIntents[0] || null,
      semantic,
      confidence: this.detectInsertIntent(userInput).confidence,
    };
  }

  /**
   * Extract element type from command with extended support
   */
  extractElementType(text) {
    const elementMatch = text.match(
      /\b(button|card|input|field|slider|toggle|spinner|modal|form|text|heading|title|h\d|label|image|photo|picture|circle|ball|dot|sphere|box|container|div|section|header|footer|navbar|menu|dropdown|tab|badge|tag|chip|alert|tooltip|popover|calendar|date|time|color|checkbox|radio|select|textarea|search|pagination|breadcrumb|section|article|nav|aside|main|link|anchor|span|paragraph|p)\b/i,
    );
    return elementMatch ? elementMatch[1].toLowerCase() : null;
  }

  /**
   * Extract all colors mentioned in the command
   */
  extractAllColors(text) {
    const colors = [];
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
      navy: "#000080",
      magenta: "#FF00FF",
      teal: "#008080",
      indigo: "#4B0082",
      neon: "#00FFFF",
    };

    // Named colors
    for (const [name, hex] of Object.entries(colorMap)) {
      if (text.includes(name)) colors.push({ name, value: hex });
    }

    // Hex colors
    const hexMatches = text.match(/#[0-9a-f]{6}/gi);
    if (hexMatches)
      colors.push(...hexMatches.map((h) => ({ name: "custom", value: h })));

    // RGB colors
    const rgbMatch = text.match(
      /rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/,
    );
    if (rgbMatch) colors.push({ name: "custom", value: rgbMatch[0] });

    return colors.length > 0 ? colors : null;
  }

  /**
   * Extract special visual effects from natural language
   */
  extractSpecialEffects(text) {
    const effects = [];
    const effectPatterns = {
      glow: /\b(glow|glowing|luminous|bright|shine|shining)\b/,
      shadow: /\b(shadow|shadowed|dark|shade)\b/,
      gradient: /\b(gradient|gradual|blend)\b/,
      blur: /\b(blur|blurred|soft|fuzzy|hazy)\b/,
      frosted: /\b(frosted|glass|transparent|translucent|frosty)\b/,
      shimmer: /\b(shimmer|sparkle|glitter|twinkle)\b/,
      neon: /\b(neon|electrical|electric)\b/,
      depth: /\b(depth|3d|shadow|inset)\b/,
    };

    for (const [effect, pattern] of Object.entries(effectPatterns)) {
      if (pattern.test(text)) effects.push(effect);
    }

    return effects.length > 0 ? effects : null;
  }

  /**
   * Process smart insert command
   * Detects intent, normalizes, and executes
   */
  async processSmartInsertCommand(userInput = "") {
    const text = String(userInput || "").trim();

    // First check: is this an insert-related command?
    const intentResult = this.detectInsertIntent(text);
    if (!intentResult.isIntent) {
      return null; // Not an insert command, return to normal chat
    }

    // Parse full natural language intent for richer context
    const naturalIntent = this.parseNaturalLanguageIntent(text);

    // Normalize the command to clean format
    const normalized = this.normalizeInsertCommand(text);

    // Try to execute normalized command through deterministic handler
    this.setAiAgentStage("parsing");
    const result = this.runDeterministicBuilderCommand(normalized);

    if (result?.applied) {
      return {
        success: true,
        normalized,
        naturalIntent,
        message: result.message || "Element inserted successfully",
        applied: result.applied,
        actions: result.actions,
      };
    }

    // If deterministic failed, return normalized command for AI processing
    return {
      success: false,
      normalized,
      naturalIntent,
      message: "Normalized command - will use AI agent",
      requiresAI: true,
      confidence: intentResult.confidence,
      intentType: intentResult.type,
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

  /**
   * Detect if user is asking for a tutorial
   * Keywords: teach, show, how, guide, explain, tutorial, learn, help
   */
  detectTutorialIntent(userInput = "") {
    const text = String(userInput || "")
      .toLowerCase()
      .trim();

    // Strong tutorial intent patterns
    const strongTutorialPatterns = [
      /\b(teach|show|demonstrate|guide|instruct)\s+(me|us|how)\b/,
      /\bhow\s+(?:do|can|to)\s+(i|we|you)\s+(?:use|work|handle|create|build|publish|monetize|sell|withdraw)\b/,
      /\btutorial\b.*(?:medialab|webbuilder|builder|workflow)/i,
      /\bshow\s+me\s+how\s+to\b/,
      /\bteach\s+me\s+(?:how\s+to\s+)?/,
      /\bget\s+started\s+with\b/,
      /\bstart\s+guide\s+for\b/,
    ];

    // Medium tutorial intent patterns
    const mediumTutorialPatterns = [
      /\b(help|assist|guide|tutorial|instruction|walkthrough)/,
      /\b(step\s+by\s*step|learn|study|understand)\b/,
      /\bhow\s+(does|do|is|can)\b.*(?:work|function|operate)\b/,
      /\bexplain\s+(?:how|what|where|why)\b/,
    ];

    // Topics they might want to learn about
    const learningTopics = [
      "medialab",
      "webbuilder",
      "builder",
      "canvas",
      "element",
      "animation",
      "design",
      "publish",
      "github",
      "render",
      "hosting",
      "monetize",
      "adsense",
      "marketplace",
      "sell",
      "withdraw",
      "payment",
      "collaboration",
      "export",
      "import",
      "template",
    ];

    // Check strong patterns
    for (const pattern of strongTutorialPatterns) {
      if (pattern.test(text)) {
        return {
          isIntent: true,
          confidence: 0.95,
          type: "strong",
        };
      }
    }

    // Check medium patterns
    for (const pattern of mediumTutorialPatterns) {
      if (pattern.test(text)) {
        return {
          isIntent: true,
          confidence: 0.8,
          type: "medium",
        };
      }
    }

    // Check if mentions learning topic
    const hasTopic = learningTopics.some((topic) => text.includes(topic));
    if (hasTopic && /\b(how|what|explain|teach|show|guide|help)\b/.test(text)) {
      return {
        isIntent: true,
        confidence: 0.75,
        type: "probable",
      };
    }

    return {
      isIntent: false,
      confidence: 0,
      type: "none",
    };
  }

  /**
   * Parse tutorial request and extract learning topic
   * Returns what the user wants to learn about
   */
  parseTutorialRequest(userInput = "") {
    const text = String(userInput || "").toLowerCase();
    const intentResult = this.detectTutorialIntent(userInput);

    // Extract learning topics
    const topicMap = {
      "creating elements": {
        keywords: [
          "insert",
          "add",
          "create",
          "element",
          "button",
          "box",
          "text",
        ],
        topic: "element-creation",
      },
      animations: {
        keywords: [
          "animate",
          "bounce",
          "glow",
          "animation",
          "motion",
          "effect",
        ],
        topic: "animations",
      },
      publishing: {
        keywords: ["publish", "github", "upload", "push", "deploy", "share"],
        topic: "publishing",
      },
      hosting: {
        keywords: ["render", "host", "deploy", "live", "server", "online"],
        topic: "hosting",
      },
      monetization: {
        keywords: ["monetize", "adsense", "earn", "money", "ad", "revenue"],
        topic: "monetization",
      },
      marketplace: {
        keywords: [
          "marketplace",
          "sell",
          "list",
          "product",
          "template",
          "sale",
        ],
        topic: "marketplace",
      },
      withdrawals: {
        keywords: ["withdraw", "payment", "payout", "cash", "money", "wallet"],
        topic: "withdrawals",
      },
      collaboration: {
        keywords: [
          "collaborate",
          "team",
          "share",
          "invite",
          "meeting",
          "co-edit",
        ],
        topic: "collaboration",
      },
      "builder basics": {
        keywords: ["use", "builder", "work", "canvas", "design", "layout"],
        topic: "builder-basics",
      },
    };

    // Find matching topic
    let selectedTopic = "general";
    let matchedTopicLabel = "MediaLab";

    for (const [label, topicData] of Object.entries(topicMap)) {
      const hasKeywords = topicData.keywords.some((keyword) =>
        text.includes(keyword),
      );
      if (hasKeywords) {
        selectedTopic = topicData.topic;
        matchedTopicLabel = label;
        break;
      }
    }

    return {
      originalInput: userInput,
      isTutorialRequest: intentResult.isIntent,
      tutorialConfidence: intentResult.confidence,
      tutorialType: intentResult.type,
      learningTopic: selectedTopic,
      topicLabel: matchedTopicLabel,
      requestDetails: {
        isAskingForSteps:
          /step\s+by\s+step|walkthrough|guide|instructions/.test(text),
        isAskingForExplanation:
          /explain|what|why|how.{0,10}(work|function|operate)/.test(text),
        isAskingForBestPractices: /best|tip|trick|practice|shortcut/.test(text),
        isAskingForTroubleshooting: /problem|issue|error|fix|help|trouble/.test(
          text,
        ),
      },
    };
  }

  /**
   * Generate tutorial system prompt for AI
   * Focused on educational, step-by-step guidance
   */
  buildTutorialSystemPrompt(topic = "general") {
    const prompts = {
      "element-creation": `You are the MediaLab Creator Assistant - a patient, knowledgeable guide for building web elements.
When the user wants to create elements (buttons, cards, text, etc.):
1. Explain what element they're creating and why
2. Walk through step-by-step: describe the element properties first
3. Suggest appealing animations or styles (bounce, glow, shadows)
4. Explain how colors and borders enhance the design
5. Show how to use simple natural language commands like "insert a red button with bounce"

Be encouraging, clear, and assume the user is learning. Provide specific examples.`,

      animations: `You are the MediaLab Animation Expert - an enthusiastic guide to creating beautiful motion effects.
When teaching animations:
1. Explain what effect the animation creates (bounce makes things jump, glow makes them shine)
2. Show how to describe animations in simple terms
3. Mention combinations (bouncing + glow for neon effects)
4. Explain timing, intensity, and when to use which effect
5. Give examples of where animations work best (buttons, badges, highlights)

Make animations sound fun and visual. Help users imagine the effect.`,

      publishing: `You are the MediaLab Publishing Coach - a clear guide to getting work online.
When explaining publishing:
1. Start with why publishing matters (sharing, hosting, monetization)
2. Explain the GitHub + Render connection step-by-step
3. Break down: save → publish to GitHub → deploy to Render
4. Explain what each step does and why it's needed
5. Show what to expect at each stage

Be reassuring and emphasize that publishing is safe and reversible.`,

      hosting: `You are the MediaLab Hosting Expert - an enthusiastic guide to making projects live.
When teaching hosting with Render:
1. Explain what hosting means and why Render helps
2. Walk through: connect GitHub → connect Render → auto deploy
3. Explain that projects auto-update when you push changes
4. Show how to see live URLs and test projects
5. Mention custom domains and what's possible

Emphasize that hosting is automatic and always available.`,

      monetization: `You are the MediaLab Monetization Advisor - a clear guide to earning from content.
When explaining earning options:
1. Explain AdSense: approve site → enable ads → earn per impressions
2. Explain Marketplace: list projects → buyers purchase → you earn per sale
3. Show the connection between quality projects and earning
4. Explain wallet management and withdrawals
5. Mention best practices (quality content, good descriptions)

Be encouraging about revenue opportunities without overselling.`,

      marketplace: `You are the MediaLab Marketplace Guide - a helpful coach for selling projects.
When teaching marketplace:
1. Explain what can be sold (templates, projects, designs)
2. Walk through listing process: prepare → upload screenshots → set price → list
3. Explain project descriptions and why they matter
4. Show how buyers find and preview projects
5. Explain rating system and how reviews help

Emphasize quality and clear descriptions lead to sales.`,

      withdrawals: `You are the MediaLab Payments Specialist - a clear guide to managing earnings.
When explaining withdrawals:
1. Show how earnings accumulate (AdSense, Marketplace, Referrals)
2. Walk through wallet system and payment methods
3. Explain withdrawal requirements and minimums
4. Show how to request payouts (PayPal, M-Pesa, bank transfer)
5. Mention tracking and payment history

Be clear about requirements and timing.`,

      collaboration: `You are the MediaLab Collaboration Guide - an enthusiastic coach for teamwork.
When teaching collaboration:
1. Explain live collaboration benefits (real-time co-editing, instant updates)
2. Walk through creating collaboration room and inviting users
3. Show permissions (host vs. collaborator) and when to use each
4. Explain chat, snapshots, and staying in sync
5. Show how to end sessions and download final work

Emphasize how collaboration makes creative work faster and more fun.`,

      "builder-basics": `You are the MediaLab Builder Tutor - a patient, encouraging guide to the canvas.
When teaching builder basics:
1. Explain the canvas (the space where you design)
2. Show adding elements, positioning, and basic styling
3. Explain how to preview and test your work
4. Show saving as drafts and how auto-save protects work
5. Explain simple ways to make things look polished

Use simple language and celebrate each step.`,

      general: `You are the MediaLab Learning Guide - a knowledgeable, patient assistant here to help users understand MediaLab.
When answering tutorial questions:
1. Assess what the user wants to learn
2. Explain concepts clearly in simple language
3. Provide step-by-step guidance when relevant
4. Give examples and show how to try it themselves
5. Celebrate their progress and encourage exploration

Be warm, encouraging, and always break things down into manageable steps.`,
    };

    return prompts[topic] || prompts.general;
  }

  /**
   * Get the Command Formatter System Prompt for Groq
   * This makes Groq act as a strict builder command formatter ONLY
   * No explanations, markdown, or conversational text - ONLY commands
   */
  getCommandFormatterSystemPrompt() {
    return `You are an elite web builder command formatter for a professional AI website builder.

Your task is to convert natural language website requests into strict builder commands ONLY.

CRITICAL RULES:
- Output ONLY valid builder commands.
- NO explanations, markdown, comments, JSON, code blocks, or extra text.
- NO conversational responses.
- Each command on a new line.
- Infer missing design details professionally and automatically.
- Expand vague requests into complete production-ready styles.
- Generate modern, visually polished UI properties.
- Include animations/background/image/layout styles when implied.
- Ensure output is parser-safe and strictly follows syntax.

COMMAND SYNTAX:
insert <element_type> <property; property; property; ...>

PROPERTY INTELLIGENCE - Convert these requests to CSS properties:
- "round" or "rounded" → border-radius:50%;
- "shadow" → box-shadow:0 8px 24px rgba(0,0,0,0.15);
- "glass" or "frosted" → backdrop-filter:blur(12px); background:rgba(255,255,255,0.15);
- "centered" → display:flex; justify-content:center; align-items:center;
- "shadow" → box-shadow:0 4px 12px rgba(0,0,0,0.1);
- "animated" or "bouncing" → animation:bounce 2s infinite ease-in-out;
- "gradient" → background:linear-gradient(135deg, #667eea 0%, #764ba2 100%);
- "floating" → transform:translateY(-4px); box-shadow:0 8px 24px rgba(0,0,0,0.2);

EXAMPLE CONVERSIONS:

User: "Make a round bouncing red button"
Output:
insert button background:red; width:48px; height:48px; border-radius:50%; border:none; padding:0; cursor:pointer; animation:bounce 2s infinite ease-in-out; box-shadow:0 4px 12px rgba(0,0,0,0.15);

User: "Create a centered hero section with gradient background"
Output:
insert section width:100%; min-height:100vh; display:flex; justify-content:center; align-items:center; background:linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding:40px;

User: "Add a glass card with shadow"
Output:
insert div width:320px; padding:24px; border-radius:16px; background:rgba(255,255,255,0.15); backdrop-filter:blur(12px); box-shadow:0 8px 24px rgba(0,0,0,0.1); border:1px solid rgba(255,255,255,0.2);

REQUIRED DEFAULTS (infer automatically):
- Padding: 16px-24px for containers, 12px for buttons
- Border-radius: 8px for cards/inputs, 50% for circles
- Font-size: 16px base, 14px small text, 24px headings
- Shadows: 0 4px 12px rgba(0,0,0,0.1) default
- Colors: Use professional palettes (grays, blues, purples)
- Spacing: Balanced margins (16px, 24px, 32px increments)

INFER USER INTENT:
If user input is vague or unclear, predict the most likely professional intention and create the best design for it.

OUTPUT ONLY COMMANDS - Nothing else. No explanation.`;
  }

  /**
   * Validate builder command syntax
   * Returns true if command follows: insert <element_type> <properties>
   */
  isValidBuilderCommand(command = "") {
    const trimmed = String(command || "").trim();
    if (!trimmed) return false;

    // Must start with 'insert'
    if (!trimmed.toLowerCase().startsWith("insert ")) return false;

    // Must have element type and at least one property
    const parts = trimmed.split(/\s+/);
    if (parts.length < 3) return false; // 'insert', 'element_type', property...

    // Check if it contains property syntax (semicolons or colon for CSS)
    if (!trimmed.includes(":") && !trimmed.includes(";")) return false;

    return true;
  }

  /**
   * Extract commands from Groq response
   * Filters out any non-command text and returns only valid commands
   */
  extractValidCommands(groqResponse = "") {
    const text = String(groqResponse || "").trim();
    if (!text) return [];

    // Split by newlines
    const lines = text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    // Filter to only valid commands
    const validCommands = lines.filter((line) =>
      this.isValidBuilderCommand(line),
    );

    return validCommands;
  }

  /**
   * Parse a single builder command into structured object
   * Example: "insert button width:48px; height:48px; border-radius:50%;"
   * Returns: { elementType: 'button', properties: { width: '48px', height: '48px', ... } }
   */
  parseBuilderCommand(command = "") {
    const trimmed = String(command || "").trim();
    if (!this.isValidBuilderCommand(trimmed)) {
      return null;
    }

    // Remove 'insert' prefix
    const withoutInsert = trimmed.replace(/^insert\s+/i, "").trim();

    // Split element type from properties
    const parts = withoutInsert.split(/\s+/);
    const elementType = parts[0];
    const propertiesStr = withoutInsert.replace(elementType, "").trim();

    // Parse properties (format: key:value; key:value;)
    const properties = {};
    const propPairs = propertiesStr
      .split(";")
      .map((pair) => pair.trim())
      .filter(Boolean);

    for (const pair of propPairs) {
      const [key, value] = pair.split(":").map((s) => s.trim());
      if (key && value) {
        properties[key] = value;
      }
    }

    return {
      command: trimmed,
      elementType,
      properties,
      rawProperties: propertiesStr,
      isValid: Object.keys(properties).length > 0,
    };
  }

  /**
   * Batch parse multiple commands from Groq response
   * Returns array of parsed command objects
   */
  parseBuilderCommands(groqResponse = "") {
    const validCommands = this.extractValidCommands(groqResponse);
    return validCommands
      .map((cmd) => this.parseBuilderCommand(cmd))
      .filter(Boolean);
  }

  /**
   * Format commands for response
   * Returns clean, parser-safe command strings
   */
  formatCommandsForResponse(commands = []) {
    return Array.isArray(commands)
      ? commands.map((cmd) =>
          String(cmd || "")
            .trim()
            .replace(/\s+/g, " "),
        )
      : [];
  }

  /**
   * Convert intent JSON from online AI into builder command
   * Takes structured intent and converts to: insert <element> <properties>
   */
  convertIntentToCommand(intentData = {}) {
    if (!intentData || !intentData.elementType) {
      return null;
    }

    const elementType = String(intentData.elementType || "div").toLowerCase();
    const props = intentData.properties || {};
    const cssProps = [];

    // Map intent properties to CSS properties
    if (props.description) {
      // Handle visual description (round, shadow, glass, etc.)
      const desc = String(props.description || "").toLowerCase();

      // Shape/Border
      if (desc.includes("round")) {
        cssProps.push("border-radius:50%");
      } else if (desc.includes("rounded")) {
        cssProps.push("border-radius:12px");
      }

      // Shadow
      if (desc.includes("shadow")) {
        cssProps.push("box-shadow:0 8px 24px rgba(0,0,0,0.15)");
      }

      // Glass effect
      if (desc.includes("glass") || desc.includes("frosted")) {
        cssProps.push("backdrop-filter:blur(12px)");
        cssProps.push("background:rgba(255,255,255,0.15)");
        cssProps.push("border:1px solid rgba(255,255,255,0.2)");
      }

      // Gradient
      if (desc.includes("gradient")) {
        cssProps.push(
          "background:linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
        );
      }
    }

    // Add colors from properties
    if (Array.isArray(props.colors) && props.colors.length > 0) {
      const firstColor = String(props.colors[0] || "")
        .trim()
        .toLowerCase();
      const colorMap = {
        red: "#FF0000",
        blue: "#0066FF",
        green: "#00CC00",
        yellow: "#FFD700",
        purple: "#9500FF",
        pink: "#FF1493",
        white: "#FFFFFF",
        black: "#000000",
        gray: "#808080",
        orange: "#FF6600",
      };
      const hexColor = colorMap[firstColor] || firstColor;
      if (firstColor) {
        cssProps.push(`background:${hexColor}`);
      }
    }

    // Add animations
    if (Array.isArray(props.animations) && props.animations.length > 0) {
      const animationMap = {
        bounce: "animation:bounce 2s infinite ease-in-out",
        glow: "animation:glow 2s infinite",
        pulse: "animation:pulse 2s infinite",
        spin: "animation:spin 1s linear infinite",
        slide: "animation:slide 0.5s ease-in-out",
      };
      const firstAnim = String(props.animations[0] || "").toLowerCase();
      if (animationMap[firstAnim]) {
        cssProps.push(animationMap[firstAnim]);
      }
    }

    // Add effects
    if (Array.isArray(props.effects)) {
      const effects = props.effects.map((e) => String(e || "").toLowerCase());
      if (
        effects.includes("shadow") &&
        !cssProps.some((p) => p.includes("box-shadow"))
      ) {
        cssProps.push("box-shadow:0 4px 12px rgba(0,0,0,0.1)");
      }
      if (effects.includes("glow")) {
        cssProps.push("filter:drop-shadow(0 0 10px rgba(0,255,255,0.5))");
      }
    }

    // Layout properties
    if (props.layout === "centered" || props.layout === "center") {
      cssProps.push("display:flex");
      cssProps.push("justify-content:center");
      cssProps.push("align-items:center");
    } else if (props.layout === "flex") {
      cssProps.push("display:flex");
      cssProps.push("flex-wrap:wrap");
      cssProps.push("gap:16px");
    } else if (props.layout === "grid") {
      cssProps.push("display:grid");
      cssProps.push(
        "grid-template-columns:repeat(auto-fit, minmax(200px, 1fr))",
      );
      cssProps.push("gap:16px");
    }

    // Positioning
    if (props.positioning) {
      const pos = String(props.positioning || "").toLowerCase();
      if (pos.includes("top")) {
        cssProps.push("position:fixed");
        cssProps.push("top:0");
        cssProps.push("left:0");
        cssProps.push("right:0");
      } else if (pos.includes("bottom")) {
        cssProps.push("position:fixed");
        cssProps.push("bottom:0");
        cssProps.push("left:0");
        cssProps.push("right:0");
      }
    }

    // Add default spacing if it's a container
    if (["div", "section", "container", "card"].includes(elementType)) {
      if (!cssProps.some((p) => p.includes("padding"))) {
        cssProps.push("padding:24px");
      }
      if (
        !cssProps.some((p) => p.includes("border-radius")) &&
        elementType === "card"
      ) {
        cssProps.push("border-radius:12px");
      }
    }

    // Add default sizing for sections
    if (elementType === "section") {
      if (!cssProps.some((p) => p.includes("width"))) {
        cssProps.push("width:100%");
      }
      if (!cssProps.some((p) => p.includes("min-height"))) {
        cssProps.push("min-height:100vh");
      }
    }

    // Remove duplicates
    const uniqueProps = [...new Set(cssProps)];

    // Build final command
    if (uniqueProps.length === 0) {
      return null;
    }

    return `insert ${elementType} ${uniqueProps.join("; ")};`;
  }
}

// Export for use in Node/Webpack environments
if (typeof module !== "undefined" && module.exports) {
  module.exports = WorkflowBrain;
}

// ES6 module export
export default WorkflowBrain;

// Make available globally in browser
if (typeof window !== "undefined") {
  window.WorkflowBrain = WorkflowBrain;
}
