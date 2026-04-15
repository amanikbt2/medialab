/**
 * Test script for Tutorial Intent Detection
 * Tests WorkflowBrain tutorial parsing and topic recognition
 */

import("./WorkflowBrain.js")
  .then((m) => {
    const WorkflowBrain = m.default;
    const brain = new WorkflowBrain();

    console.log("🎓 Tutorial Intent Detection Tests\n");
    console.log("=".repeat(60));

    // Test cases
    const testCases = [
      {
        prompt: "teach me how to use medialab",
        expectedTopic: "general",
        description: "Basic tutorial request",
      },
      {
        prompt: "show me how to insert a button",
        expectedTopic: "element-creation",
        description: "Element creation tutorial",
      },
      {
        prompt: "how do I create animations?",
        expectedTopic: "animations",
        description: "Animation tutorial request",
      },
      {
        prompt: "can you show me step by step how to publish my project",
        expectedTopic: "publishing",
        description: "Publishing tutorial (with step-by-step)",
      },
      {
        prompt: "explain how to deploy to render",
        expectedTopic: "hosting",
        description: "Hosting/deployment tutorial",
      },
      {
        prompt: "I want to learn how to monetize my projects with adsense",
        expectedTopic: "monetization",
        description: "Monetization tutorial",
      },
      {
        prompt: "teach me how to sell projects in the marketplace",
        expectedTopic: "marketplace",
        description: "Marketplace sales tutorial",
      },
      {
        prompt: "how do I withdraw my earnings",
        expectedTopic: "withdrawals",
        description: "Withdrawals/payments tutorial",
      },
      {
        prompt: "show me how to collaborate with teammates",
        expectedTopic: "collaboration",
        description: "Collaboration tutorial",
      },
      {
        prompt: "beginner guide to using the web builder",
        expectedTopic: "builder-basics",
        description: "Builder basics tutorial",
      },
      {
        prompt: "can you fix this code?",
        expectedTopic: null,
        description: "Not a tutorial request (code fix)",
      },
      {
        prompt: "what is the capital of france?",
        expectedTopic: null,
        description: "Not a tutorial request (random question)",
      },
    ];

    console.log("\n📋 Running tests...\n");

    testCases.forEach((testCase, index) => {
      const result = brain.parseTutorialRequest(testCase.prompt);
      const intentResult = brain.detectTutorialIntent(testCase.prompt);

      const isPassed =
        (testCase.expectedTopic === null && !result.isTutorialRequest) ||
        (testCase.expectedTopic !== null &&
          result.isTutorialRequest &&
          result.learningTopic === testCase.expectedTopic);

      const status = isPassed ? "✅" : "❌";
      console.log(`${status} Test ${index + 1}: ${testCase.description}`);
      console.log(`   Prompt: "${testCase.prompt}"`);
      console.log(`   Is Tutorial: ${result.isTutorialRequest}`);
      console.log(`   Topic: ${result.learningTopic || "N/A"}`);
      console.log(
        `   Confidence: ${intentResult.confidence} (${intentResult.type})`,
      );

      if (result.isTutorialRequest && result.requestDetails) {
        const details = result.requestDetails;
        const activeFeaturesI = [];
        if (details.isAskingForSteps) activeFeaturesI.push("step-by-step");
        if (details.isAskingForExplanation) activeFeaturesI.push("explanation");
        if (details.isAskingForBestPractices)
          activeFeaturesI.push("best-practices");
        if (details.isAskingForTroubleshooting)
          activeFeaturesI.push("troubleshooting");
        if (activeFeaturesI.length > 0) {
          console.log(`   Request style: ${activeFeaturesI.join(", ")}`);
        }
      }

      console.log();
    });

    // Test system prompts
    console.log("=".repeat(60));
    console.log("\n📖 Sample System Prompts Generated\n");

    const topicsToTest = ["element-creation", "animations", "publishing"];

    topicsToTest.forEach((topic) => {
      const systemPrompt = brain.buildTutorialSystemPrompt(topic);
      console.log(`\n🔹 Topic: ${topic.toUpperCase()}\n`);
      console.log(systemPrompt.substring(0, 200) + "...\n");
    });

    console.log("=".repeat(60));
    console.log("\n✨ Tutorial Detection Tests Complete!\n");
  })
  .catch((err) => {
    console.error("Error loading WorkflowBrain:", err);
  });
