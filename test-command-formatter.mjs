/**
 * Test script for Command Formatter System
 * Tests WorkflowBrain command parsing and validation
 */

import("./WorkflowBrain.js")
  .then((m) => {
    const WorkflowBrain = m.default;
    const brain = new WorkflowBrain();

    console.log("🚀 Workflow AI Command Formatter Tests\n");
    console.log("=".repeat(70));

    // Test 1: Validate command syntax
    console.log("\n📋 Test 1: Command Validation\n");

    const testCommands = [
      {
        cmd: "insert button width:48px; height:48px; border-radius:50%;",
        shouldBeValid: true,
        description: "Valid button command",
      },
      {
        cmd: "insert div background:red; padding:16px;",
        shouldBeValid: true,
        description: "Valid div command",
      },
      {
        cmd: "insert section width:100%; min-height:100vh; background:linear-gradient(135deg, #667eea 0%, #764ba2 100%);",
        shouldBeValid: true,
        description: "Valid hero section command",
      },
      {
        cmd: "Some random text without insert",
        shouldBeValid: false,
        description: "Invalid - no insert keyword",
      },
      {
        cmd: "insert button",
        shouldBeValid: false,
        description: "Invalid - no properties",
      },
      {
        cmd: "",
        shouldBeValid: false,
        description: "Invalid - empty string",
      },
    ];

    testCommands.forEach((test, idx) => {
      const isValid = brain.isValidBuilderCommand(test.cmd);
      const status = isValid === test.shouldBeValid ? "✅" : "❌";
      console.log(`${status} ${test.description}`);
      console.log(`   Input: "${test.cmd}"`);
      console.log(`   Valid: ${isValid}`);
      if (isValid !== test.shouldBeValid) {
        console.log(`   ⚠️  Expected: ${test.shouldBeValid}, Got: ${isValid}`);
      }
      console.log();
    });

    // Test 2: Parse commands
    console.log("=".repeat(70));
    console.log("\n📦 Test 2: Command Parsing\n");

    const parseCases = [
      "insert button width:48px; height:48px; border-radius:50%; background:red;",
      "insert div display:flex; justify-content:center; align-items:center; background:blue;",
      "insert section width:100%; min-height:100vh; background:linear-gradient(135deg, #667eea 0%, #764ba2 100%);",
    ];

    parseCases.forEach((cmd, idx) => {
      const parsed = brain.parseBuilderCommand(cmd);
      if (parsed) {
        console.log(`✅ Parsed Command ${idx + 1}`);
        console.log(`   Element Type: ${parsed.elementType}`);
        console.log(
          `   Properties: ${Object.keys(parsed.properties).length} properties`,
        );
        console.log(
          `   Props: ${Object.entries(parsed.properties)
            .slice(0, 3)
            .map(([k, v]) => `${k}:${v}`)
            .join(
              "; ",
            )}${Object.keys(parsed.properties).length > 3 ? "..." : ""}`,
        );
        console.log();
      }
    });

    // Test 3: Extract valid commands from response
    console.log("=".repeat(70));
    console.log("\n🔍 Test 3: Command Extraction from Groq Response\n");

    const mockGroqResponse = `insert button width:48px; height:48px; border-radius:50%; background:red; animation:bounce 2s infinite;
insert div display:flex; justify-content:center; align-items:center; width:100%;
Some explanatory text that shouldn't be here
insert section min-height:100vh; background:linear-gradient(135deg, #667eea 0%, #764ba2 100%);
More text explanation`;

    const extractedCommands = brain.extractValidCommands(mockGroqResponse);
    console.log(
      `Found ${extractedCommands.length} valid commands in mock response:\n`,
    );
    extractedCommands.forEach((cmd, idx) => {
      console.log(
        `  ${idx + 1}. ${cmd.substring(0, 60)}${cmd.length > 60 ? "..." : ""}`,
      );
    });

    // Test 4: Batch parse
    console.log("\n" + "=".repeat(70));
    console.log("\n🔄 Test 4: Batch Command Parsing\n");

    const parsedBatch = brain.parseBuilderCommands(mockGroqResponse);
    console.log(
      `Batch parsed ${parsedBatch.length} commands with properties:\n`,
    );
    parsedBatch.forEach((cmd, idx) => {
      if (cmd.isValid) {
        console.log(
          `  ${idx + 1}. <${cmd.elementType}> with ${Object.keys(cmd.properties).length} properties`,
        );
      }
    });

    // Test 5: System prompt
    console.log("\n" + "=".repeat(70));
    console.log("\n📖 Test 5: System Prompt\n");

    const systemPrompt = brain.getCommandFormatterSystemPrompt();
    console.log("✅ System prompt generated successfully");
    console.log(`   Length: ${systemPrompt.length} characters`);
    console.log(
      `   Contains command syntax rules: ${systemPrompt.includes("insert <element_type>")}`,
    );
    console.log(
      `   Contains property intelligence: ${systemPrompt.includes("border-radius:50%")}`,
    );
    console.log(
      `   Contains example conversions: ${systemPrompt.includes("User:")}`,
    );

    // Test 6: Command formatting consistency
    console.log("\n" + "=".repeat(70));
    console.log("\n✨ Test 6: Format Consistency\n");

    const messyCommands = [
      "insert    button    width:48px;   height:48px;   border-radius:50%;",
      "insert button width:48px; height:48px;",
      "insert button width:48px;height:48px;border-radius:50%;",
    ];

    const formatted = brain.formatCommandsForResponse(messyCommands);
    console.log("✅ Formatted commands for consistent output:\n");
    formatted.forEach((cmd, idx) => {
      console.log(`  ${idx + 1}. ${cmd}`);
    });

    console.log("\n" + "=".repeat(70));
    console.log("\n✨ Command Formatter Tests Complete!\n");
  })
  .catch((err) => {
    console.error("❌ Error:", err);
  });
