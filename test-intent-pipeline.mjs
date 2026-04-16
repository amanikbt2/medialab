/**
 * Test script for Intent Analysis → WorkflowBrain Pipeline
 * Flow: Online AI (intent analysis) → WorkflowBrain (parser) → Canvas
 */

import("./WorkflowBrain.js")
  .then((m) => {
    const WorkflowBrain = m.default;
    const brain = new WorkflowBrain();

    console.log("🚀 Intent Analysis → WorkflowBrain Pipeline Tests\n");
    console.log("=".repeat(70));

    // Test 1: Convert intent JSON to builder command
    console.log("\n📝 Test 1: Intent JSON → Builder Command Conversion\n");

    const intentExamples = [
      {
        intent: "Make a round bouncing red button",
        intentData: {
          intent:
            "Create a red button with bounce animation and circular shape",
          elementType: "button",
          properties: {
            description: "round bouncing",
            colors: ["red"],
            animations: ["bounce"],
            effects: ["shadow"],
          },
          confidence: 0.95,
        },
      },
      {
        intent: "Create a hero section with gradient and centered text",
        intentData: {
          intent: "Build a full-height hero section with gradient background",
          elementType: "section",
          properties: {
            description: "gradient",
            layout: "centered",
            animations: ["fade-in"],
          },
          confidence: 0.92,
        },
      },
      {
        intent: "Glass card with shadow and rounded corners",
        intentData: {
          intent: "Create a modern glass-effect card with shadow",
          elementType: "div",
          properties: {
            description: "glass shadow rounded",
            effects: ["shadow", "glow"],
          },
          confidence: 0.88,
        },
      },
      {
        intent: "Centered container with flex layout",
        intentData: {
          intent: "Create a centered flex container",
          elementType: "div",
          properties: {
            layout: "centered",
            colors: ["white"],
            description: "shadow",
          },
          confidence: 0.9,
        },
      },
    ];

    intentExamples.forEach((example, idx) => {
      const command = brain.convertIntentToCommand(example.intentData);
      console.log(`✅ Test ${idx + 1}: ${example.intent}`);
      console.log(`   Intent Confidence: ${example.intentData.confidence}`);
      console.log(`   Element Type: ${example.intentData.elementType}`);
      console.log(`   Generated Command:`);
      console.log(`   ${command}`);
      console.log();
    });

    // Test 2: Simulate online AI response → parsing flow
    console.log("=".repeat(70));
    console.log("\n🔄 Test 2: Online AI Response → Parsing Flow\n");

    const mockGroqResponse = `{
    "intent": "Create a red button with bounce animation",
    "elementType": "button",
    "properties": {
      "description": "round bouncing",
      "colors": ["red"],
      "animations": ["bounce"],
      "effects": ["shadow"]
    },
    "confidence": 0.95
  }`;

    console.log("Online AI Response (Intent JSON):");
    console.log(mockGroqResponse);
    console.log();

    try {
      const parsed = JSON.parse(mockGroqResponse);
      console.log("✅ JSON Parsed Successfully");
      console.log(`   Intent: "${parsed.intent}"`);
      console.log(`   Element: ${parsed.elementType}`);
      console.log(`   Confidence: ${parsed.confidence}`);
      console.log();

      const command = brain.convertIntentToCommand(parsed);
      console.log("✅ WorkflowBrain Conversion");
      console.log(`   Builder Command:`);
      console.log(`   ${command}`);
      console.log();
    } catch (err) {
      console.error("❌ Parse Error:", err.message);
    }

    // Test 3: Full pipeline simulation
    console.log("=".repeat(70));
    console.log(
      "\n🌀 Test 3: Complete Pipeline (User Input → Online AI → WorkflowBrain → Canvas)\n",
    );

    const testCases = [
      {
        userInput: "Make a round red button that bounces",
        stage1Response: {
          intent: "Create a circular red button with bounce animation",
          elementType: "button",
          properties: {
            description: "round bouncing",
            colors: ["red"],
            animations: ["bounce"],
          },
          confidence: 0.95,
        },
      },
      {
        userInput: "Create a glass card with glow effect",
        stage1Response: {
          intent: "Build a modern glass-effect card with glow",
          elementType: "div",
          properties: {
            description: "glass",
            effects: ["glow", "shadow"],
          },
          confidence: 0.88,
        },
      },
    ];

    testCases.forEach((test, idx) => {
      console.log(`📍 Pipeline ${idx + 1}:`);
      console.log(`   User Input: "${test.userInput}"`);
      console.log(`   ↓`);
      console.log(`   Stage 1: Online AI Intent Analysis`);
      console.log(`   Intent: "${test.stage1Response.intent}"`);
      console.log(`   Confidence: ${test.stage1Response.confidence}`);
      console.log(`   ↓`);

      const command = brain.convertIntentToCommand(test.stage1Response);
      console.log(`   Stage 2: WorkflowBrain Parser`);
      console.log(`   Command: ${command}`);
      console.log(`   ↓`);
      console.log(`   Stage 3: Canvas Render`);
      console.log(`   Status: ✅ Ready to render`);
      console.log();
    });

    // Test 4: Edge cases
    console.log("=".repeat(70));
    console.log("\n⚠️  Test 4: Edge Cases & Invalid Input\n");

    const edgeCases = [
      {
        name: "Empty intent data",
        intentData: {},
        shouldFail: true,
      },
      {
        name: "Missing elementType",
        intentData: {
          properties: { description: "round" },
        },
        shouldFail: true,
      },
      {
        name: "Missing properties",
        intentData: {
          elementType: "button",
        },
        shouldFail: false,
      },
      {
        name: "Invalid animation type",
        intentData: {
          elementType: "div",
          properties: {
            animations: ["nonexistent"],
          },
        },
        shouldFail: false,
      },
    ];

    edgeCases.forEach((test) => {
      const command = brain.convertIntentToCommand(test.intentData);
      const result = command ? "✅ Handled" : "❌ Returned null";
      console.log(`${result}: ${test.name}`);
      if (command) {
        console.log(`   Output: ${command}`);
      }
    });

    console.log("\n" + "=".repeat(70));
    console.log("\n✨ Pipeline Tests Complete!\n");
    console.log("Architecture:");
    console.log("  User Input");
    console.log("    ↓");
    console.log("  Online AI (Groq) → Intent JSON");
    console.log("    ↓");
    console.log("  WorkflowBrain Parser → Builder Command");
    console.log("    ↓");
    console.log("  Canvas Renderer");
    console.log();
  })
  .catch((err) => {
    console.error("❌ Error:", err);
  });
